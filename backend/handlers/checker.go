package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

type CheckHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewCheckHandler(cfg *config.Config, db *database.DB) *CheckHandler {
	return &CheckHandler{cfg: cfg, db: db}
}

type AccountResult struct {
	SteamID    string `json:"steam_id"`
	Name       string `json:"name"`
	Avatar     string `json:"avatar"`
	Status     string `json:"status"`
	BanType    string `json:"ban_type,omitempty"`
	BanReason  string `json:"ban_reason,omitempty"`
	BanDaysAgo *int   `json:"ban_days_ago,omitempty"`
	BanDate    string `json:"ban_date,omitempty"`
	FearStatus string `json:"fear_status,omitempty"`
	KD         *float64 `json:"kd,omitempty"`
	Playtime   *int     `json:"playtime,omitempty"`
}

type checkRequest struct {
	SteamIDs []string `json:"steam_ids"`
}

type searchRequest struct {
	Query string `json:"query"`
}

func (h *CheckHandler) Search(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req searchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	q := strings.TrimSpace(req.Query)
	if q == "" {
		http.Error(w, `{"error":"query required"}`, http.StatusBadRequest)
		return
	}

	steamIDs := make([]string, 0)

	if h.db != nil {
		found, _ := h.db.SearchSteamIDs(q)
		steamIDs = append(steamIDs, found...)
	}

	seen := make(map[string]bool)
	unique := make([]string, 0)
	for _, sid := range steamIDs {
		sid = strings.TrimSpace(sid)
		if sid != "" && !seen[sid] {
			seen[sid] = true
			unique = append(unique, sid)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"steam_ids":  unique,
		"query":      q,
	})
}

func (h *CheckHandler) Check(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req checkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(req.SteamIDs) == 0 {
		http.Error(w, `{"error":"steam_ids required"}`, http.StatusBadRequest)
		return
	}

	if len(req.SteamIDs) > 50 {
		http.Error(w, `{"error":"max 50 accounts"}`, http.StatusBadRequest)
		return
	}

	results := make([]AccountResult, len(req.SteamIDs))
	var wg sync.WaitGroup

	for i, sid := range req.SteamIDs {
		wg.Add(1)
		go func(idx int, steamID string) {
			defer wg.Done()
			results[idx] = h.checkSingleAccount(steamID)
		}(i, sid)
	}

	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    results,
	})
}

func (h *CheckHandler) checkSingleAccount(steamID string) AccountResult {
	result := AccountResult{
		SteamID: steamID,
		Name:    "",
		Status:  "not_found",
	}

	var profile map[string]interface{}
	var vacStatus map[string]interface{}
	var fearStatus map[string]interface{}

	var wg sync.WaitGroup
	wg.Add(3)

	go func() {
		defer wg.Done()
		profile = h.fetchProfile(steamID)
	}()
	go func() {
		defer wg.Done()
		vacStatus = h.checkVAC(steamID)
	}()
	go func() {
		defer wg.Done()
		fearStatus = h.checkFearBan(steamID)
	}()

	wg.Wait()

	if profile != nil {
		if n, ok := profile["name"].(string); ok {
			result.Name = n
		}
		if avatar, ok := profile["avatar"].(string); ok {
			result.Avatar = avatar
		}
		if kd, ok := profile["kd"].(float64); ok {
			result.KD = &kd
		}
		if pt, ok := profile["playtime"].(int); ok {
			result.Playtime = &pt
		}
	}

	if vacStatus != nil {
		if banned, ok := vacStatus["banned"].(bool); ok && banned {
			result.Status = "banned"
			result.BanType = "VAC"
			if days, ok := vacStatus["days_ago"].(int); ok {
				result.BanDaysAgo = &days
			}
			if date, ok := vacStatus["date"].(string); ok {
				result.BanDate = date
			}
			return result
		}
	}

	if fearStatus != nil {
		if banned, ok := fearStatus["banned"].(bool); ok && banned {
			result.Status = "banned"
			if t, ok := fearStatus["type"].(string); ok {
				result.BanType = t
			}
			if reason, ok := fearStatus["reason"].(string); ok {
				result.BanReason = reason
			}
			return result
		}
		if status, ok := fearStatus["status"].(string); ok {
			result.FearStatus = status
		}
	}

	if profile != nil {
		result.Status = "clean"
		if result.FearStatus == "" {
			result.FearStatus = "Аккаунт чист"
		}
	}

	return result
}

func (h *CheckHandler) fetchProfile(steamID string) map[string]interface{} {
	url := fmt.Sprintf("https://api.fearproject.ru/profile/%s", steamID)
	data := h.httpGet(url)
	if data == nil {
		return nil
	}

	name := ""
	if n, ok := data["name"].(string); ok {
		name = n
	}

	avatar := ""
	if a, ok := data["avatar_full"].(string); ok {
		avatar = a
	}

	var kd *float64
	var playtime *int
	if stats, ok := data["stats"].(map[string]interface{}); ok {
		if k, ok := stats["kills"].(float64); ok {
			if d, ok := stats["deaths"].(float64); ok && d > 0 {
				v := k / d
				kd = &v
			}
		}
		if pt, ok := stats["playtime"].(float64); ok {
			v := int(pt)
			playtime = &v
		}
	}

	return map[string]interface{}{
		"name":      name,
		"avatar":    avatar,
		"kd":        kd,
		"playtime":  playtime,
	}
}

func (h *CheckHandler) checkVAC(steamID string) map[string]interface{} {
	url := fmt.Sprintf("https://steamcommunity.com/profiles/%s/vacstatus", steamID)
	client := &http.Client{Timeout: 8 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	text := string(body)

	result := map[string]interface{}{
		"banned": false,
	}

	if strings.Contains(text, "VAC Banned") || strings.Contains(text, "Game Ban") {
		result["banned"] = true
	}

	return result
}

func (h *CheckHandler) checkFearBan(steamID string) map[string]interface{} {
	url := fmt.Sprintf("https://api.fearproject.ru/bans/check/%s", steamID)
	data := h.httpGet(url)
	if data == nil {
		return map[string]interface{}{
			"banned": false,
			"status": "Аккаунт чист",
		}
	}

	if banned, ok := data["banned"].(bool); ok && banned {
		banType := "GAME"
		if t, ok := data["type"].(string); ok {
			banType = strings.ToUpper(t)
		}
		reason := ""
		if r, ok := data["reason"].(string); ok {
			reason = r
		}
		return map[string]interface{}{
			"banned":  true,
			"type":    banType,
			"reason":  reason,
		}
	}

	return map[string]interface{}{
		"banned": false,
		"status": "Аккаунт чист",
	}
}

func (h *CheckHandler) httpGet(url string) map[string]interface{} {
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	return result
}
