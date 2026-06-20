package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

// Evader — игрок, у которого в одном из .vdf-файлов есть забаненный аккаунт,
// а сам он сейчас играет с другого аккаунта из того же файла.
type Evader struct {
	SteamID       string `json:"steam_id"`
	Name          string `json:"name"`
	Avatar        string `json:"avatar,omitempty"`
	CheckID       int    `json:"check_id"`
	Filename      string `json:"filename"`
	BannedSteamID string `json:"banned_steam_id"`
	BanReason     string `json:"ban_reason"`
	ServerName    string `json:"server_name"`
	ServerIP      string `json:"server_ip"`
	ServerPort    string `json:"server_port"`
	DetectedAt    string `json:"detected_at"`
}

type vdfResult struct {
	SteamID      string                 `json:"steamid"`
	Nickname     string                 `json:"nickname"`
	OnFear       bool                   `json:"on_fear"`
	FearBanned   bool                   `json:"fear_banned"`
	FearReason   string                 `json:"fear_reason"`
	VacBanned    bool                   `json:"vac_banned"`
	GameBans     int                    `json:"game_bans"`
	CommunityBan bool                   `json:"community_ban"`
	YoomaData    map[string]interface{} `json:"yooma_data"`
	AdminGroup   string                 `json:"admin_group"`
}

func (r vdfResult) isBanned() bool {
	if r.FearBanned || r.VacBanned || r.CommunityBan || r.GameBans > 0 {
		return true
	}
	if r.YoomaData == nil {
		return false
	}
	if found, ok := r.YoomaData["found"].(bool); ok && found {
		return true
	}
	if punishments, ok := r.YoomaData["punishments"].([]interface{}); ok {
		for _, p := range punishments {
			pm, ok := p.(map[string]interface{})
			if !ok {
				continue
			}
			if status, ok := pm["status"].(string); ok && status == "active" {
				return true
			}
		}
	}
	return false
}

type onlinePlayer struct {
	steamID string
	name    string
	server  map[string]interface{}
}

type EvadersHandler struct {
	cfg    *config.Config
	db     *database.DB
	client *http.Client
	cache  *evadersCache
}

type evadersCache struct {
	mu        sync.RWMutex
	data      []Evader
	timestamp time.Time
}

func NewEvadersHandler(cfg *config.Config, db *database.DB) *EvadersHandler {
	return &EvadersHandler{
		cfg:    cfg,
		db:     db,
		client: &http.Client{Timeout: 15 * time.Second},
		cache:  &evadersCache{},
	}
}

func (h *EvadersHandler) GetEvaders(w http.ResponseWriter, r *http.Request) {
	h.cache.mu.RLock()
	if time.Since(h.cache.timestamp) < 2*time.Minute && h.cache.data != nil {
		h.writeJSON(w, h.cache.data)
		h.cache.mu.RUnlock()
		return
	}
	h.cache.mu.RUnlock()

	evaders, err := h.computeEvaders()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	h.cache.mu.Lock()
	h.cache.data = evaders
	h.cache.timestamp = time.Now()
	h.cache.mu.Unlock()

	h.writeJSON(w, evaders)
}

func (h *EvadersHandler) writeJSON(w http.ResponseWriter, data []Evader) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

func (h *EvadersHandler) computeEvaders() ([]Evader, error) {
	// Пытаемся получить из БД
	checks, err := h.db.GetVDFChecks()
	if err == nil && len(checks) > 0 {
		return h.computeEvadersFromDB(checks)
	}

	// Fallback на KV Store
	vdfData, err := h.db.GetKVStore("vdf_checks.json")
	if err != nil {
		return nil, fmt.Errorf("failed to read vdf checks: %w", err)
	}

	var store map[string]interface{}
	if err := json.Unmarshal(vdfData, &store); err != nil {
		return nil, fmt.Errorf("failed to parse vdf checks: %w", err)
	}

	checksMap, ok := store["checks"].(map[string]interface{})
	if !ok {
		return []Evader{}, nil
	}

	servers, err := h.fetchServers()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch online servers: %w", err)
	}
	online := extractOnlinePlayers(servers)

	seen := make(map[string]bool)
	var evaders []Evader

	for checkIDStr, checkData := range checksMap {
		checkID, err := strconv.Atoi(checkIDStr)
		if err != nil {
			continue
		}

		check, ok := checkData.(map[string]interface{})
		if !ok {
			continue
		}

		results, ok := check["results"].([]interface{})
		if !ok {
			continue
		}

		var bannedAccounts []vdfResult
		for _, r := range results {
			result, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			vdfRes := h.mapToVDFResult(result)
			if vdfRes.isBanned() {
				bannedAccounts = append(bannedAccounts, vdfRes)
			}
		}

		if len(bannedAccounts) == 0 {
			continue
		}

		for _, r := range results {
			result, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			vdfRes := h.mapToVDFResult(result)
			if vdfRes.isBanned() {
				continue
			}

			player, ok := online[vdfRes.SteamID]
			if !ok {
				continue
			}
			if seen[vdfRes.SteamID] {
				continue
			}
			seen[vdfRes.SteamID] = true

			banned := bannedAccounts[0]
			banReason := detectBanReason(banned)

			evaders = append(evaders, Evader{
				SteamID:       vdfRes.SteamID,
				Name:          player.name,
				CheckID:       checkID,
				Filename:      getString(check, "filename"),
				BannedSteamID: banned.SteamID,
				BanReason:     banReason,
				ServerName:    getString(player.server, "site_name"),
				ServerIP:      getString(player.server, "ip"),
				ServerPort:    fmt.Sprintf("%v", player.server["port"]),
				DetectedAt:    time.Now().UTC().Format(time.RFC3339),
			})
		}
	}

	return evaders, nil
}

func (h *EvadersHandler) computeEvadersFromDB(checks []database.VDFCheckData) ([]Evader, error) {
	servers, err := h.fetchServers()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch online servers: %w", err)
	}
	online := extractOnlinePlayers(servers)

	seen := make(map[string]bool)
	var evaders []Evader

	for _, check := range checks {
		var results []vdfResult
		if err := json.Unmarshal(check.Results, &results); err != nil {
			continue
		}

		var bannedAccounts []vdfResult
		for _, r := range results {
			if r.isBanned() {
				bannedAccounts = append(bannedAccounts, r)
			}
		}

		if len(bannedAccounts) == 0 {
			continue
		}

		for _, r := range results {
			if r.isBanned() {
				continue
			}

			player, ok := online[r.SteamID]
			if !ok {
				continue
			}
			if seen[r.SteamID] {
				continue
			}
			seen[r.SteamID] = true

			banned := bannedAccounts[0]
			banReason := detectBanReason(banned)

			evaders = append(evaders, Evader{
				SteamID:       r.SteamID,
				Name:          player.name,
				CheckID:       check.CheckID,
				Filename:      check.Filename,
				BannedSteamID: banned.SteamID,
				BanReason:     banReason,
				ServerName:    getString(player.server, "site_name"),
				ServerIP:      getString(player.server, "ip"),
				ServerPort:    fmt.Sprintf("%v", player.server["port"]),
				DetectedAt:    time.Now().UTC().Format(time.RFC3339),
			})
		}
	}

	return evaders, nil
}

func (h *EvadersHandler) mapToVDFResult(m map[string]interface{}) vdfResult {
	result := vdfResult{
		SteamID:      getString(m, "steamid"),
		Nickname:     getString(m, "nickname"),
		FearBanned:   getBool(m, "fear_banned"),
		FearReason:   getString(m, "fear_reason"),
		VacBanned:    getBool(m, "vac_banned"),
		CommunityBan: getBool(m, "community_ban"),
		AdminGroup:   getString(m, "admin_group"),
	}

	if gameBans, ok := m["game_bans"].(float64); ok {
		result.GameBans = int(gameBans)
	}

	if yoomaData, ok := m["yooma_data"].(map[string]interface{}); ok {
		result.YoomaData = yoomaData
	}

	return result
}

func detectBanReason(r vdfResult) string {
	if r.FearBanned {
		if r.FearReason != "" {
			return r.FearReason
		}
		return "Fear Ban"
	}
	if r.VacBanned {
		return "VAC Ban"
	}
	if r.CommunityBan {
		return "Community Ban"
	}
	if r.GameBans > 0 {
		return "Game Ban"
	}
	if r.YoomaData != nil {
		if found, ok := r.YoomaData["found"].(bool); ok && found {
			return "Yooma Ban"
		}
	}
	return "Banned"
}

func (h *EvadersHandler) fetchServers() ([]map[string]interface{}, error) {
	req, _ := http.NewRequest("GET", "https://api.fearproject.ru/servers", nil)
	req.Header.Set("User-Agent", "FearStaff-Panel/1.0")
	req.Header.Set("Accept", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("fear api returned %d", resp.StatusCode)
	}

	var data []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

func extractOnlinePlayers(servers []map[string]interface{}) map[string]onlinePlayer {
	online := make(map[string]onlinePlayer)
	for _, srv := range servers {
		liveData, ok := srv["live_data"].(map[string]interface{})
		if !ok {
			continue
		}
		players, ok := liveData["players"].([]interface{})
		if !ok {
			continue
		}
		for _, p := range players {
			player, ok := p.(map[string]interface{})
			if !ok {
				continue
			}
			sid, _ := player["steam_id"].(string)
			if sid == "" {
				continue
			}
			name := getString(player, "nickname")
			if name == "" {
				name = getString(player, "name")
			}
			online[sid] = onlinePlayer{
				steamID: sid,
				name:    name,
				server:  srv,
			}
		}
	}
	return online
}

func getBool(m map[string]interface{}, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

