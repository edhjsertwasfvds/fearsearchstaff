package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

type FearAPIHandler struct {
	cfg    *config.Config
	db     *database.DB
	client *http.Client
	nameMu sync.RWMutex
	nameMap map[string]ProfileInfo
}

type ProfileInfo struct {
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

func NewFearAPIHandler(cfg *config.Config, db *database.DB) *FearAPIHandler {
	return &FearAPIHandler{
		cfg:    cfg,
		db:     db,
		client: &http.Client{Timeout: 15 * time.Second},
		nameMap: make(map[string]ProfileInfo),
	}
}

func (h *FearAPIHandler) fearHeaders() http.Header {
	headers := http.Header{}
	headers.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	headers.Set("Accept", "application/json, text/plain, */*")
	headers.Set("Referer", "https://fearproject.ru/")
	headers.Set("Origin", "https://fearproject.ru")
	if h.cfg.FearCookie != "" {
		cleaned := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(h.cfg.FearCookie, "\n", ""), "\r", ""))
		if cleaned != "" {
			headers.Set("Cookie", cleaned)
		}
	}
	return headers
}

func (h *FearAPIHandler) fearGet(url string) map[string]interface{} {
	req, _ := http.NewRequest("GET", url, nil)
	for k, v := range h.fearHeaders() {
		req.Header[k] = v
	}
	resp, err := h.client.Do(req)
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

func (h *FearAPIHandler) fearGetRaw(url string) []byte {
	req, _ := http.NewRequest("GET", url, nil)
	for k, v := range h.fearHeaders() {
		req.Header[k] = v
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return body
}

func (h *FearAPIHandler) proxyGet(w http.ResponseWriter, r *http.Request, apiURL string) {
	req, _ := http.NewRequest("GET", apiURL, nil)
	for k, v := range h.fearHeaders() {
		req.Header[k] = v
	}
	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"fear api error: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

func (h *FearAPIHandler) resolveNames(steamIDs []string) {
	if len(steamIDs) == 0 {
		return
	}

	var toFetch []string
	h.nameMu.RLock()
	for _, sid := range steamIDs {
		if _, ok := h.nameMap[sid]; !ok {
			toFetch = append(toFetch, sid)
		}
	}
	h.nameMu.RUnlock()

	if len(toFetch) == 0 {
		return
	}

	if h.db != nil {
		cached, _ := h.db.GetProfilesBatch(toFetch)
		var stillMissing []string
		for _, sid := range toFetch {
			if c, ok := cached[sid]; ok {
				h.nameMu.Lock()
				h.nameMap[sid] = ProfileInfo{Name: c.Name, Avatar: c.Avatar}
				h.nameMu.Unlock()
			} else {
				stillMissing = append(stillMissing, sid)
			}
		}
		toFetch = stillMissing
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 20)

	for _, sid := range toFetch {
		wg.Add(1)
		sem <- struct{}{}
		go func(s string) {
			defer wg.Done()
			defer func() { <-sem }()
			data := h.fearGet(fmt.Sprintf("https://api.fearproject.ru/profile/%s", s))
			if data == nil {
				return
			}
			name := ""
			if n, ok := data["name"].(string); ok {
				name = n
			}
			avatar := ""
			if a, ok := data["avatar_full"].(string); ok {
				avatar = a
			} else if a, ok := data["avatar"].(string); ok {
				avatar = a
			}
			mu.Lock()
			h.nameMap[s] = ProfileInfo{Name: name, Avatar: avatar}
			mu.Unlock()
			if h.db != nil {
				h.db.UpsertProfileCache(s, name, avatar)
			}
		}(sid)
	}
	wg.Wait()
}

func (h *FearAPIHandler) GetName(steamID string) ProfileInfo {
	h.nameMu.RLock()
	defer h.nameMu.RUnlock()
	if p, ok := h.nameMap[steamID]; ok {
		return p
	}
	return ProfileInfo{}
}

func (h *FearAPIHandler) GetServers(w http.ResponseWriter, r *http.Request) {
	h.proxyGet(w, r, "https://api.fearproject.ru/servers")
}

func (h *FearAPIHandler) GetLeaderboard(w http.ResponseWriter, r *http.Request) {
	h.proxyGet(w, r, "https://api.fearproject.ru/leaderboard")
}

func (h *FearAPIHandler) GetProfile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]
	h.proxyGet(w, r, fmt.Sprintf("https://api.fearproject.ru/profile/%s", steamID))
}

func (h *FearAPIHandler) GetSkinchanger(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]
	h.proxyGet(w, r, fmt.Sprintf("https://api.fearproject.ru/skinchanger/player?steamid=%s&mode=public", steamID))
}

func (h *FearAPIHandler) GetPunishments(w http.ResponseWriter, r *http.Request) {
	query := r.URL.RawQuery
	apiURL := "https://api.fearproject.ru/punishments"
	if query != "" {
		apiURL += "?" + query
	}
	h.proxyGet(w, r, apiURL)
}

func (h *FearAPIHandler) SearchPunishments(w http.ResponseWriter, r *http.Request) {
	query := r.URL.RawQuery
	apiURL := "https://api.fearproject.ru/punishments/search"
	if query != "" {
		apiURL += "?" + query
	}
	h.proxyGet(w, r, apiURL)
}

func (h *FearAPIHandler) GetPunishmentsByAdmin(w http.ResponseWriter, r *http.Request) {
	adminSteamID := r.URL.Query().Get("admin_steamid")
	if adminSteamID == "" {
		http.Error(w, `{"error":"admin_steamid required"}`, http.StatusBadRequest)
		return
	}

	type punishResp struct {
		Punishments []struct {
			ID          int64  `json:"id"`
			AdminSteam  string `json:"admin_steamid"`
			SteamID     string `json:"steamid"`
			Reason      string `json:"reason"`
			Type        int    `json:"type"`
			Status      int    `json:"status"`
			Time        string `json:"time"`
			ServerID    int    `json:"server_id"`
			AdminName   string `json:"admin_name"`
			Name        string `json:"name"`
			Duration    int    `json:"duration"`
			Created     int64  `json:"created"`
		} `json:"punishments"`
		Total int `json:"total"`
	}

	allPunishments := make([]interface{}, 0)

	for ptype := 1; ptype <= 2; ptype++ {
		page := 1
		for page <= 50 {
			apiURL := fmt.Sprintf("https://api.fearproject.ru/punishments/search?q=%s&page=%d&limit=20&type=%d", adminSteamID, page, ptype)
			body := h.fearGetRaw(apiURL)
			if body == nil {
				break
			}
			var data punishResp
			if err := json.Unmarshal(body, &data); err != nil {
				break
			}
			for _, p := range data.Punishments {
				if strings.TrimSpace(p.AdminSteam) == strings.TrimSpace(adminSteamID) {
					allPunishments = append(allPunishments, map[string]interface{}{
						"id":           p.ID,
						"admin_steamid": p.AdminSteam,
						"steamid":      p.SteamID,
						"reason":       p.Reason,
						"type":         p.Type,
						"status":       p.Status,
						"time":         p.Time,
						"server_id":    p.ServerID,
						"admin_name":   p.AdminName,
						"name":         p.Name,
						"duration":     p.Duration,
						"created":      p.Created,
					})
				}
			}
			if len(data.Punishments) < 20 {
				break
			}
			page++
		}
	}

	idsToResolve := []string{adminSteamID}
	for _, p := range allPunishments {
		if pm, ok := p.(map[string]interface{}); ok {
			if sid, ok := pm["steamid"].(string); ok && sid != "" {
				idsToResolve = append(idsToResolve, sid)
			}
		}
	}
	h.resolveNames(idsToResolve)
	for _, p := range allPunishments {
		if pm, ok := p.(map[string]interface{}); ok {
			if sid, ok := pm["steamid"].(string); ok {
				if info := h.GetName(sid); info.Name != "" {
					pm["name"] = info.Name
				}
				pm["avatar"] = h.GetName(sid).Avatar
			}
			if asid, ok := pm["admin_steamid"].(string); ok {
				if info := h.GetName(asid); info.Name != "" {
					pm["admin_name"] = info.Name
				}
				pm["admin_avatar"] = h.GetName(asid).Avatar
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"punishments": allPunishments,
		"total":       len(allPunishments),
	})
}

func (h *FearAPIHandler) GetAllPunishments(w http.ResponseWriter, r *http.Request) {
	pType := r.URL.Query().Get("type")
	status := r.URL.Query().Get("status")
	page := r.URL.Query().Get("page")
	search := r.URL.Query().Get("search")
	if page == "" {
		page = "1"
	}

	apiURL := fmt.Sprintf("https://api.fearproject.ru/punishments/search?page=%s&limit=50", page)
	if pType != "" {
		apiURL += "&type=" + pType
	}
	if status != "" {
		apiURL += "&status=" + status
	}
	if search != "" {
		apiURL += "&q=" + search
	}

	body := h.fearGetRaw(apiURL)
	if body == nil {
		http.Error(w, `{"error":"fear api error"}`, http.StatusBadGateway)
		return
	}

	type rawPunishment struct {
		ID           int64  `json:"id"`
		SteamID      string `json:"steamid"`
		AdminSteamID string `json:"admin_steamid"`
		AdminName    string `json:"admin_name"`
		Name         string `json:"name"`
		Reason       string `json:"reason"`
		Type         int    `json:"type"`
		Status       int    `json:"status"`
		Duration     int    `json:"duration"`
		Created      int64  `json:"created"`
	}
	type rawResp struct {
		Punishments []rawPunishment `json:"punishments"`
		Total       int             `json:"total"`
	}

	var resp rawResp
	if err := json.Unmarshal(body, &resp); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
		return
	}

	steamIDsToResolve := make([]string, 0)
	for _, p := range resp.Punishments {
		if p.Name == "" && p.SteamID != "" {
			steamIDsToResolve = append(steamIDsToResolve, p.SteamID)
		}
		if p.AdminName == "" && p.AdminSteamID != "" {
			steamIDsToResolve = append(steamIDsToResolve, p.AdminSteamID)
		}
	}

	if len(steamIDsToResolve) > 0 {
		unique := make([]string, 0)
		seen := make(map[string]bool)
		for _, sid := range steamIDsToResolve {
			if !seen[sid] {
				seen[sid] = true
				unique = append(unique, sid)
			}
		}
		h.resolveNames(unique)
	}

	for i := range resp.Punishments {
		if resp.Punishments[i].Name == "" {
			if p := h.GetName(resp.Punishments[i].SteamID); p.Name != "" {
				resp.Punishments[i].Name = p.Name
			}
		}
		if resp.Punishments[i].AdminName == "" {
			if p := h.GetName(resp.Punishments[i].AdminSteamID); p.Name != "" {
				resp.Punishments[i].AdminName = p.Name
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *FearAPIHandler) CheckBan(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]
	h.proxyGet(w, r, fmt.Sprintf("https://api.fearproject.ru/bans/check/%s", steamID))
}

func (h *FearAPIHandler) GetYoomaBans(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]

	apiURL := fmt.Sprintf("https://yooma.su/api/public/read/punishments?punish_type=0&search=%s&page=1&mobile=1", steamID)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Referer", "https://yooma.su/ru/punishments")
	req.Header.Set("Origin", "https://yooma.su")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"yooma api error: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func (h *FearAPIHandler) GetSteamSummary(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]
	apiURL := fmt.Sprintf("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=9EA60BC3158081747D77604EB9819F19&steamids=%s", steamID)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("User-Agent", "FearStaff-Panel/1.0")
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"steam api error: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func (h *FearAPIHandler) GetSteamBans(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]
	apiURL := fmt.Sprintf("https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=9EA60BC3158081747D77604EB9819F19&steamids=%s", steamID)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("User-Agent", "FearStaff-Panel/1.0")
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"steam api error: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func (h *FearAPIHandler) GetSteamFriends(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]
	apiURL := fmt.Sprintf("https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=9EA60BC3158081747D77604EB9819F19&steamid=%s&relationship=friend", steamID)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("User-Agent", "FearStaff-Panel/1.0")
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"steam api error: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func (h *FearAPIHandler) GetSteamLevel(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}
	steamID := parts[len(parts)-1]
	apiURL := fmt.Sprintf("https://api.steampowered.com/IPlayer/GetSteamLevel/v1/?key=9EA60BC3158081747D77604EB9819F19&steamid=%s", steamID)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("User-Agent", "FearStaff-Panel/1.0")
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"steam api error: %s"}`, err.Error()), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func (h *FearAPIHandler) GetStaffStats(w http.ResponseWriter, r *http.Request) {
	adminSteamIDs := r.URL.Query().Get("steamids")
	if adminSteamIDs == "" {
		http.Error(w, `{"error":"steamids required"}`, http.StatusBadRequest)
		return
	}

	type punishment struct {
		AdminSteam  string `json:"admin_steamid"`
		SteamID     string `json:"steamid"`
		Type        int    `json:"type"`
		Status      int    `json:"status"`
		Duration    int    `json:"duration"`
		AdminName   string `json:"admin_name"`
	}
	type punishResp struct {
		Punishments []punishment `json:"punishments"`
	}

	ids := strings.Split(adminSteamIDs, ",")
	statsMap := make(map[string]map[string]interface{})

	for _, sid := range ids {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			continue
		}
		statsMap[sid] = map[string]interface{}{
			"steamid":      sid,
			"total_bans":   0, "total_mutes": 0,
			"active_bans":  0, "active_mutes": 0,
			"removed_bans": 0, "removed_mutes": 0,
			"expired_bans": 0, "expired_mutes": 0,
			"name":         "",
		}
	}

	for ptype := 1; ptype <= 2; ptype++ {
		for status := 1; status <= 4; status++ {
			if status == 3 {
				continue
			}
			for page := 1; page <= 10; page++ {
				apiURL := fmt.Sprintf("https://api.fearproject.ru/punishments?page=%d&limit=100&type=%d&status=%d", page, ptype, status)
				body := h.fearGetRaw(apiURL)
				if body == nil {
					break
				}
				var data punishResp
				if err := json.Unmarshal(body, &data); err != nil {
					break
				}
				for _, p := range data.Punishments {
					adminID := strings.TrimSpace(p.AdminSteam)
					if _, ok := statsMap[adminID]; !ok {
						continue
					}
					if p.Type == 1 {
						statsMap[adminID]["total_bans"] = statsMap[adminID]["total_bans"].(int) + 1
						if status == 1 {
							statsMap[adminID]["active_bans"] = statsMap[adminID]["active_bans"].(int) + 1
						} else if status == 2 {
							statsMap[adminID]["removed_bans"] = statsMap[adminID]["removed_bans"].(int) + 1
						} else if status == 4 {
							statsMap[adminID]["expired_bans"] = statsMap[adminID]["expired_bans"].(int) + 1
						}
					} else if p.Type == 2 {
						statsMap[adminID]["total_mutes"] = statsMap[adminID]["total_mutes"].(int) + 1
						if status == 1 {
							statsMap[adminID]["active_mutes"] = statsMap[adminID]["active_mutes"].(int) + 1
						} else if status == 2 {
							statsMap[adminID]["removed_mutes"] = statsMap[adminID]["removed_mutes"].(int) + 1
						} else if status == 4 {
							statsMap[adminID]["expired_mutes"] = statsMap[adminID]["expired_mutes"].(int) + 1
						}
					}
					if statsMap[adminID]["name"] == "" && p.AdminName != "" {
						statsMap[adminID]["name"] = p.AdminName
					}
				}
				if len(data.Punishments) < 100 {
					break
				}
			}
		}
	}

	result := make([]interface{}, 0)
	for _, v := range statsMap {
		v["total"] = v["total_bans"].(int) + v["total_mutes"].(int)
		v["active_total"] = v["active_bans"].(int) + v["active_mutes"].(int)
		v["expired_total"] = v["expired_bans"].(int) + v["expired_mutes"].(int)
		v["removed_total"] = v["removed_bans"].(int) + v["removed_mutes"].(int)
		result = append(result, v)
	}

	steamIDsToResolve := make([]string, 0)
	for _, sid := range ids {
		sid = strings.TrimSpace(sid)
		if sid != "" {
			steamIDsToResolve = append(steamIDsToResolve, sid)
		}
	}
	if len(steamIDsToResolve) > 0 {
		h.resolveNames(steamIDsToResolve)
	}

	for _, v := range result {
		sid, _ := v["steamid"].(string)
		if p := h.GetName(sid); p.Name != "" {
			v["name"] = p.Name
		}
		v["avatar"] = h.GetName(sid).Avatar
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"stats":   result,
	})
}

func (h *FearAPIHandler) GetAdmins(w http.ResponseWriter, r *http.Request) {
	if h.cfg.FearCookie == "" {
		http.Error(w, `{"error":"FEAR_COOKIE not configured"}`, http.StatusInternalServerError)
		return
	}

	body := h.fearGetRaw("https://api.fearproject.ru/admins/")
	if body == nil {
		http.Error(w, `{"error":"failed to fetch admins from fearproject"}`, http.StatusBadGateway)
		return
	}

	var admins []map[string]interface{}
	if err := json.Unmarshal(body, &admins); err != nil {
		var resp map[string]interface{}
		if err2 := json.Unmarshal(body, &resp); err2 == nil {
			if arr, ok := resp["admins"].([]interface{}); ok {
				admins = make([]map[string]interface{}, 0, len(arr))
				for _, a := range arr {
					if m, ok := a.(map[string]interface{}); ok {
						admins = append(admins, m)
					}
				}
			}
		}
	}

	if h.db != nil && len(admins) > 0 {
		if err := h.db.UpsertStaffList(admins); err != nil {
			log.Printf("⚠️ Failed to save staff list to DB: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"admins":  admins,
		"total":   len(admins),
	})
}

func (h *FearAPIHandler) GetResolveNames(w http.ResponseWriter, r *http.Request) {
	idsParam := r.URL.Query().Get("ids")
	if idsParam == "" {
		http.Error(w, `{"error":"ids required"}`, http.StatusBadRequest)
		return
	}
	ids := strings.Split(idsParam, ",")
	unique := make([]string, 0)
	seen := make(map[string]bool)
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	h.resolveNames(unique)
	result := make(map[string]ProfileInfo)
	h.nameMu.RLock()
	for _, id := range unique {
		if p, ok := h.nameMap[id]; ok {
			result[id] = p
		}
	}
	h.nameMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"profiles": result,
	})
}
