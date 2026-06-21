package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
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
	SteamID        string  `json:"steam_id"`
	Name           string  `json:"name"`
	Avatar         string  `json:"avatar"`
	Status         string  `json:"status"`
	BanType        string  `json:"ban_type,omitempty"`
	BanReason      string  `json:"ban_reason,omitempty"`
	BanDaysAgo     *int    `json:"ban_days_ago,omitempty"`
	BanDate        string  `json:"ban_date,omitempty"`
	FearBanned     bool    `json:"fear_banned"`
	FearReason     string  `json:"fear_reason,omitempty"`
	FearUnbanTime  string  `json:"fear_unban_time,omitempty"`
	VACBanned      bool    `json:"vac_banned"`
	VACDaysAgo     int     `json:"vac_days_ago,omitempty"`
	GameBans       int     `json:"game_bans,omitempty"`
	YoomaBanned    bool    `json:"yooma_banned"`
	YoomaReason    string  `json:"yooma_reason,omitempty"`
	FearURL        string  `json:"fear_url"`
	SteamURL       string  `json:"steam_url"`
	YoomaURL       string  `json:"yooma_url"`
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

	if len(steamIDs) == 0 && h.db != nil {
		adminsRaw, _ := h.db.GetKVStore("admins_cache.json")
		if adminsRaw != nil {
			var admins []map[string]interface{}
			if json.Unmarshal(adminsRaw, &admins) == nil {
				qLower := strings.ToLower(q)
				for _, a := range admins {
					name := ""
					if v, ok := a["name"].(string); ok {
						name = v
					}
					discordName := ""
					if v, ok := a["discord_nickname"].(string); ok {
						discordName = v
					}
					discordID := ""
					if v, ok := a["discord_id"].(string); ok {
						discordID = v
					}
					sid := ""
					if v, ok := a["steamid"].(string); ok {
						sid = v
					}

					if strings.Contains(strings.ToLower(name), qLower) || strings.Contains(strings.ToLower(discordName), qLower) || discordID == q || sid == q {
						if sid != "" {
							steamIDs = append(steamIDs, sid)
						}
					}
				}
			}
		}
	}

	if len(steamIDs) == 0 && h.cfg.FearCookie != "" {
		type fearAdmin struct {
			SteamID string `json:"steamid"`
			Name    string `json:"name"`
			DiscID  string `json:"discord_id"`
		}
		client := &http.Client{Timeout: 15 * time.Second}
		cleanedCookie := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(h.cfg.FearCookie, "\n", ""), "\r", ""))
		fearReq, _ := http.NewRequest("GET", "https://api.fearproject.ru/admins/", nil)
		fearReq.Header.Set("Cookie", cleanedCookie)
		fearReq.Header.Set("Referer", "https://fearproject.ru/")
		fearReq.Header.Set("Origin", "https://fearproject.ru")
		fearReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
		resp, err := client.Do(fearReq)
		if err == nil {
			defer resp.Body.Close()
			var raw json.RawMessage
			if json.NewDecoder(resp.Body).Decode(&raw) == nil {
				var adminsArr []fearAdmin
				var adminsObj map[string]interface{}
				if json.Unmarshal(raw, &adminsArr) == nil {
					qLower := strings.ToLower(q)
					for _, a := range adminsArr {
						if strings.Contains(strings.ToLower(a.Name), qLower) || a.DiscID == q || a.SteamID == q {
							steamIDs = append(steamIDs, a.SteamID)
						}
					}
				} else if json.Unmarshal(raw, &adminsObj) == nil {
					if arr, ok := adminsObj["admins"].([]interface{}); ok {
						qLower := strings.ToLower(q)
						for _, item := range arr {
							if m, ok := item.(map[string]interface{}); ok {
								sid, _ := m["steamid"].(string)
								name, _ := m["name"].(string)
								discID, _ := m["discord_id"].(string)
								if strings.Contains(strings.ToLower(name), qLower) || discID == q || sid == q {
									steamIDs = append(steamIDs, sid)
								}
							}
						}
					}
				}
			}
		}
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
		"success":   true,
		"steam_ids": unique,
		"query":     q,
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

func (h *CheckHandler) CheckVDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, `{"error":"invalid form"}`, http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"error":"file required"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	body, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, `{"error":"failed to read file"}`, http.StatusInternalServerError)
		return
	}

	steamIDs := make([]string, 0)
	seen := make(map[string]bool)
	text := string(body)

	// 1. config.vdf: "SteamID" "76561..."
	re1 := regexp.MustCompile(`"SteamID"\s+"(7656\d{13})"`)
	for _, m := range re1.FindAllStringSubmatch(text, -1) {
		if len(m) > 1 && !seen[m[1]] {
			seen[m[1]] = true
			steamIDs = append(steamIDs, m[1])
		}
	}

	// 2. loginusers.vdf: "76561198000000000" (SteamID как ключ секции)
	if len(steamIDs) == 0 {
		re2 := regexp.MustCompile(`"(7656119\d{10})"`)
		for _, m := range re2.FindAllStringSubmatch(text, -1) {
			if len(m) > 1 && !seen[m[1]] {
				seen[m[1]] = true
				steamIDs = append(steamIDs, m[1])
			}
		}
	}

	// 3. Фоллбек: любой 7656119 + 10 цифр
	if len(steamIDs) == 0 {
		re3 := regexp.MustCompile(`(7656119\d{10})`)
		for _, m := range re3.FindAllStringSubmatch(text, -1) {
			if len(m) > 1 && !seen[m[1]] {
				seen[m[1]] = true
				steamIDs = append(steamIDs, m[1])
			}
		}
	}

	if len(steamIDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    true,
			"steam_ids":  []string{},
			"count":      0,
			"message":    "SteamID не найдены в файле",
		})
		return
	}

	results := make([]AccountResult, len(steamIDs))
	var wg sync.WaitGroup
	for i, sid := range steamIDs {
		wg.Add(1)
		go func(idx int, steamID string) {
			defer wg.Done()
			results[idx] = h.checkSingleAccount(steamID)
		}(i, sid)
	}
	wg.Wait()

	banned := 0
	for _, r := range results {
		if r.Status == "banned" {
			banned++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"steam_ids":    steamIDs,
		"count":        len(steamIDs),
		"banned_count": banned,
		"results":      results,
	})
}

func (h *CheckHandler) checkSingleAccount(steamID string) AccountResult {
	result := AccountResult{
		SteamID:  steamID,
		Name:     "",
		Status:   "not_found",
		FearURL:  fmt.Sprintf("https://fearproject.ru/profile/%s", steamID),
		SteamURL: fmt.Sprintf("https://steamcommunity.com/profiles/%s", steamID),
		YoomaURL: fmt.Sprintf("https://yooma.su/card/%s", steamID),
	}

	type fearProfileResp struct {
		Name        string `json:"name"`
		AvatarFull  string `json:"avatar_full"`
		Avatar      string `json:"avatar"`
		BanInfo struct {
			IsBanned       bool        `json:"isBanned"`
			UnbanTimestamp interface{} `json:"unbanTimestamp"`
			Reason         interface{} `json:"reason"`
		} `json:"banInfo"`
	}

	type steamSummaryResp struct {
		Response struct {
			Players []struct {
				SteamId      string `json:"steamid"`
				Personaname  string `json:"personaname"`
				Avatarfull   string `json:"avatarfull"`
				Avatarmedium string `json:"avatarmedium"`
				Profileurl   string `json:"profileurl"`
				Personastate int    `json:"personastate"`
			} `json:"players"`
		} `json:"response"`
	}

	type steamBansResp struct {
		Players []struct {
			SteamId          string `json:"SteamId"`
			VACBanned        bool   `json:"VACBanned"`
			NumberOfVACBans  int    `json:"NumberOfVACBans"`
			DaysSinceLastBan int    `json:"DaysSinceLastBan"`
			NumberOfGameBans int    `json:"NumberOfGameBans"`
			CommunityBanned  bool   `json:"CommunityBanned"`
		} `json:"players"`
	}

	type yoomaResp struct {
		Found       bool `json:"found"`
		Punishments []struct {
			Status   string `json:"status"`
			Reason   string `json:"reason"`
			TypeName string `json:"type_name"`
		} `json:"punishments"`
	}

	var profile fearProfileResp
	var steamSummary steamSummaryResp
	var steamBans steamBansResp
	var yooma yoomaResp

	var wg sync.WaitGroup
	wg.Add(4)

	go func() {
		defer wg.Done()
		url := fmt.Sprintf("https://api.fearproject.ru/profile/%s", steamID)
		data := h.httpGet(url)
		if data != nil {
			if n, ok := data["name"].(string); ok {
				profile.Name = n
			}
			if a, ok := data["avatar_full"].(string); ok {
				profile.AvatarFull = a
			} else if a, ok := data["avatar"].(string); ok {
				profile.Avatar = a
			}
			if bi, ok := data["banInfo"].(map[string]interface{}); ok {
				if ib, ok := bi["isBanned"].(bool); ok {
					profile.BanInfo.IsBanned = ib
				}
				profile.BanInfo.UnbanTimestamp = bi["unbanTimestamp"]
				profile.BanInfo.Reason = bi["reason"]
			}
		}
	}()

	go func() {
		defer wg.Done()
		steamKey := h.cfg.SteamAPIKey
		if steamKey == "" {
			steamKey = "9EA60BC3158081747D77604EB9819F19"
		}
		url := fmt.Sprintf("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=%s&steamids=%s", steamKey, steamID)
		client := &http.Client{Timeout: 10 * time.Second}
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", "FearStaff-Panel/1.0")
		resp, err := client.Do(req)
		if err != nil {
			return
		}
		defer resp.Body.Close()
		json.NewDecoder(resp.Body).Decode(&steamSummary)
	}()

	go func() {
		defer wg.Done()
		steamKey := h.cfg.SteamAPIKey
		if steamKey == "" {
			steamKey = "9EA60BC3158081747D77604EB9819F19"
		}
		url := fmt.Sprintf("https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=%s&steamids=%s", steamKey, steamID)
		client := &http.Client{Timeout: 10 * time.Second}
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", "FearStaff-Panel/1.0")
		resp, err := client.Do(req)
		if err != nil {
			return
		}
		defer resp.Body.Close()
		json.NewDecoder(resp.Body).Decode(&steamBans)
	}()

	go func() {
		defer wg.Done()
		url := fmt.Sprintf("https://yooma.su/api/public/read/punishments?punish_type=0&search=%s&page=1&mobile=1", steamID)
		client := &http.Client{Timeout: 10 * time.Second}
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0")
		req.Header.Set("Referer", "https://yooma.su/")
		resp, err := client.Do(req)
		if err != nil {
			return
		}
		defer resp.Body.Close()
		json.NewDecoder(resp.Body).Decode(&yooma)
	}()

	wg.Wait()

	result.Name = profile.Name

	if profile.AvatarFull != "" {
		result.Avatar = profile.AvatarFull
	} else if profile.Avatar != "" {
		result.Avatar = profile.Avatar
	} else if len(steamSummary.Response.Players) > 0 {
		sp := steamSummary.Response.Players[0]
		if sp.Avatarfull != "" {
			result.Avatar = sp.Avatarfull
		} else if sp.Avatarmedium != "" {
			result.Avatar = sp.Avatarmedium
		}
		if result.Name == "" && sp.Personaname != "" {
			result.Name = sp.Personaname
		}
	}

	if profile.BanInfo.IsBanned {
		result.FearBanned = true
		result.Status = "banned"
		result.BanType = "FEAR"
		if profile.BanInfo.Reason != nil {
			if r, ok := profile.BanInfo.Reason.(string); ok {
				result.FearReason = r
				result.BanReason = r
			}
		}
		if profile.BanInfo.UnbanTimestamp != nil {
			if ts, ok := profile.BanInfo.UnbanTimestamp.(float64); ok && ts > 0 {
				result.FearUnbanTime = fmt.Sprintf("до %s", time.Unix(int64(ts), 0).UTC().Format("02.01.2006 15:04"))
			}
		} else if profile.BanInfo.IsBanned {
			result.FearUnbanTime = "Навсегда"
		}
	}

	if len(steamBans.Players) > 0 {
		p := steamBans.Players[0]
		if p.VACBanned {
			result.VACBanned = true
			result.VACDaysAgo = p.DaysSinceLastBan
			if !result.FearBanned {
				result.Status = "banned"
				result.BanType = "VAC"
				result.BanDaysAgo = &p.DaysSinceLastBan
			}
		}
		result.GameBans = p.NumberOfGameBans
		if p.NumberOfGameBans > 0 && !result.FearBanned && !p.VACBanned {
			result.Status = "banned"
			result.BanType = "GAME"
		}
	}

	if yooma.Found {
		for _, y := range yooma.Punishments {
			if y.Status == "active" {
				result.YoomaBanned = true
				result.YoomaReason = y.Reason
				if !result.FearBanned && !result.VACBanned {
					result.Status = "banned"
					result.BanType = "YOOMA"
					result.BanReason = y.Reason
				}
				break
			}
		}
	}

	if result.Status == "not_found" {
		if profile.Name != "" {
			result.Status = "clean"
		}
	}

	return result
}

func (h *CheckHandler) httpGet(url string) map[string]interface{} {
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://fearproject.ru/")
	req.Header.Set("Origin", "https://fearproject.ru")
	if h.cfg.FearCookie != "" {
		cleaned := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(h.cfg.FearCookie, "\n", ""), "\r", ""))
		if cleaned != "" {
			req.Header.Set("Cookie", cleaned)
		}
	}

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
