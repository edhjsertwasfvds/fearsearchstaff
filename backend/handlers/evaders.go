package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

// Evader — игрок, у которого в одном из .vdf-файлов есть забаненный аккаунт,
// а сам он сейчас играет с другого аккаунта из того же файла.
type Evader struct {
	SteamID       string         `json:"steam_id"`
	Name          string         `json:"name"`
	Avatar        string         `json:"avatar,omitempty"`
	CheckID       int            `json:"check_id"`
	Filename      string         `json:"filename"`
	BannedSteamID string         `json:"banned_steam_id"`
	BanReason     string         `json:"ban_reason"`
	BannedCount   int            `json:"banned_count"`
	BannedDetails []BannedDetail `json:"banned_details"`
	ServerName    string         `json:"server_name"`
	ServerIP      string         `json:"server_ip"`
	ServerPort    string         `json:"server_port"`
	DetectedAt    string         `json:"detected_at"`
}

type BannedDetail struct {
	SteamID   string            `json:"steam_id"`
	Name      string            `json:"name"`
	Bans      string            `json:"bans"`
	FearBan   *BanSourceDetail  `json:"fear_ban,omitempty"`
	VacBan    bool              `json:"vac_ban"`
	GameBans  int               `json:"game_bans"`
	YoomaBan  *BanSourceDetail  `json:"yooma_ban,omitempty"`
}

type BanSourceDetail struct {
	Reason    string `json:"reason"`
	UnbanDate string `json:"unban_date,omitempty"`
}

type vdfStore struct {
	Checks map[string]struct {
		Results   []vdfResult `json:"results"`
		Filename  string      `json:"filename"`
		Timestamp string      `json:"timestamp"`
	} `json:"checks"`
}

type vdfResult struct {
	SteamID      string                 `json:"steamid"`
	Nickname     string                 `json:"nickname"`
	OnFear       bool                   `json:"on_fear"`
	FearBanned   bool                   `json:"fear_banned"`
	FearReason   string                 `json:"fear_reason"`
	FearUnban    string                 `json:"fear_unban"`
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
	if h.db == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": []interface{}{}})
		return
	}

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
	servers, err := h.fetchServers()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch online servers: %w", err)
	}
	online := extractOnlinePlayers(servers)

	// Способ 1: из PostgreSQL vdf_history
	if h.db != nil {
		history, err := h.db.GetVDFHistoryDetailed(500)
		if err == nil && len(history) > 0 {
			return h.computeEvadersFromHistory(history, online), nil
		}
	}

	// Способ 2: fallback на KV store
	vdfData, err := h.db.GetKVStore("vdf_checks.json")
	if err != nil {
		return nil, fmt.Errorf("failed to read vdf checks: %w", err)
	}

	var store vdfStore
	if err := json.Unmarshal(vdfData, &store); err != nil {
		return nil, fmt.Errorf("failed to parse vdf checks: %w", err)
	}

	return h.computeEvadersFromKV(store, online), nil
}

func (h *EvadersHandler) computeEvadersFromHistory(history []map[string]interface{}, online map[string]onlinePlayer) []Evader {
	// Группируем по config_hash — один конфиг = одна «семья» аккаунтов
	type configGroup struct {
		accounts map[string]map[string]interface{} // steamid -> latest history entry
	}

	groups := make(map[string]*configGroup)
	steamidToConfigs := make(map[string][]string)

	for _, entry := range history {
		hash, _ := entry["config_hash"].(string)
		sid, _ := entry["steamid"].(string)
		if hash == "" || sid == "" {
			continue
		}
		if groups[hash] == nil {
			groups[hash] = &configGroup{accounts: make(map[string]map[string]interface{})}
		}
		// Берём только последнюю запись для каждого steamid в конфиге
		if _, exists := groups[hash].accounts[sid]; !exists {
			groups[hash].accounts[sid] = entry
		}
		steamidToConfigs[sid] = appendUnique(steamidToConfigs[sid], hash)
	}

	seen := make(map[string]bool)
	var evaders []Evader

	for _, grp := range groups {
		// Определяем забаненных в конфиге
		var bannedSteamIDs []string
		bannedDetails := make([]BannedDetail, 0)

		for sid, entry := range grp.accounts {
			isBanned := false
			if fb, ok := entry["fear_banned"].(bool); ok && fb {
				isBanned = true
			}
			if vb, ok := entry["vac_banned"].(bool); ok && vb {
				isBanned = true
			}
			if gb, ok := entry["game_bans"].(float64); ok && gb > 0 {
				isBanned = true
			}
			if yb, ok := entry["yooma_banned"].(bool); ok && yb {
				isBanned = true
			}

			if isBanned {
				bannedSteamIDs = append(bannedSteamIDs, sid)
				parts := []string{}
				var fearDetail *BanSourceDetail
				if fb, _ := entry["fear_banned"].(bool); fb {
					reason, _ := entry["fear_reason"].(string)
					if reason == "" {
						reason = "Обход"
					}
					parts = append(parts, "Fear: "+reason)
					unban, _ := entry["fear_unban_time"].(string)
					fearDetail = &BanSourceDetail{Reason: reason, UnbanDate: unban}
				}
				if vb, _ := entry["vac_banned"].(bool); vb {
					parts = append(parts, "VAC")
				}
				if gb, _ := entry["game_bans"].(float64); gb > 0 {
					parts = append(parts, fmt.Sprintf("Game Ban (×%d)", int(gb)))
				}
				if yb, _ := entry["yooma_banned"].(bool); yb {
					reason, _ := entry["yooma_reason"].(string)
					if reason == "" {
						reason = "Yooma Ban"
					}
					parts = append(parts, "Yooma: "+reason)
				}
				banStr := "Banned"
				if len(parts) > 0 {
					banStr = strings.Join(parts, " | ")
				}
				nickname, _ := entry["nickname"].(string)
				bannedDetails = append(bannedDetails, BannedDetail{
					SteamID: sid,
					Name:    nickname,
					Bans:    banStr,
					FearBan: fearDetail,
					VacBan:  mustBool(entry["vac_banned"]),
					GameBans: mustInt(entry["game_bans"]),
					YoomaBan: extractYoomaDetail(entry),
				})
			}
		}

		if len(bannedSteamIDs) == 0 {
			continue
		}

		// Ищем «чистых» игроков из этого конфига, которые сейчас онлайн
		for sid, entry := range grp.accounts {
			if isStringInSlice(sid, bannedSteamIDs) {
				continue
			}
			player, ok := online[sid]
			if !ok {
				continue
			}
			if seen[sid] {
				continue
			}
			seen[sid] = true

			nickname, _ := entry["nickname"].(string)
			evaders = append(evaders, Evader{
				SteamID:       sid,
				Name:          player.name,
				BannedSteamID: bannedSteamIDs[0],
				BanReason:     detectBanReasonFromHistory(bannedDetails),
				BannedCount:   len(bannedSteamIDs),
				BannedDetails: bannedDetails,
				ServerName:    getString(player.server, "site_name"),
				ServerIP:      getString(player.server, "ip"),
				ServerPort:    fmt.Sprintf("%v", player.server["port"]),
				Filename:      mustString(entry["filename"]),
				DetectedAt:    time.Now().UTC().Format(time.RFC3339),
			})
			_ = nickname
		}
	}

	return evaders
}

func (h *EvadersHandler) computeEvadersFromKV(store vdfStore, online map[string]onlinePlayer) []Evader {
	seen := make(map[string]bool)
	var evaders []Evader

	for checkIDStr, check := range store.Checks {
		checkID, err := strconv.Atoi(checkIDStr)
		if err != nil {
			continue
		}

		var bannedAccounts []vdfResult
		for _, r := range check.Results {
			if r.isBanned() {
				bannedAccounts = append(bannedAccounts, r)
			}
		}
		if len(bannedAccounts) == 0 {
			continue
		}

		for _, r := range check.Results {
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

			details := make([]BannedDetail, 0, len(bannedAccounts))
			for _, ba := range bannedAccounts {
				parts := []string{}
				var fearDetail *BanSourceDetail
				if ba.FearBanned {
					reason := ba.FearReason
					if reason == "" {
						reason = "Обход"
					}
					parts = append(parts, "Fear: "+reason)
					fearDetail = &BanSourceDetail{Reason: reason, UnbanDate: ba.FearUnban}
				}
				if ba.VacBanned {
					parts = append(parts, "VAC")
				}
				if ba.GameBans > 0 {
					parts = append(parts, fmt.Sprintf("Game Ban (×%d)", ba.GameBans))
				}
				var yoomaDetail *BanSourceDetail
				if ba.YoomaData != nil {
					if found, _ := ba.YoomaData["found"].(bool); found {
						if punishments, ok := ba.YoomaData["punishments"].([]interface{}); ok && len(punishments) > 0 {
							for _, p := range punishments {
								pm, ok := p.(map[string]interface{})
								if !ok {
									continue
								}
								if status, _ := pm["status"].(string); status == "active" {
									reason, _ := pm["reason"].(string)
									if reason == "" {
										reason = "Haron Anti-Cheats"
									}
									parts = append(parts, "Yooma.su: "+reason)
									yDate := ""
									if ts, ok := pm["created_at"].(float64); ok && ts > 0 {
										yDate = time.Unix(int64(ts), 0).UTC().Format("02.01.2006 15:04")
									} else if ds, ok := pm["date"].(string); ok && ds != "" {
										yDate = ds
									}
									yoomaDetail = &BanSourceDetail{Reason: reason, UnbanDate: yDate}
									break
								}
							}
						} else {
							parts = append(parts, "Yooma.su: Ban")
							yoomaDetail = &BanSourceDetail{Reason: "Ban"}
						}
					}
				}
				banStr := "Banned"
				if len(parts) > 0 {
					banStr = strings.Join(parts, " | ")
				}
				details = append(details, BannedDetail{
					SteamID:  ba.SteamID,
					Name:     ba.Nickname,
					Bans:     banStr,
					FearBan:  fearDetail,
					VacBan:   ba.VacBanned,
					GameBans: ba.GameBans,
					YoomaBan: yoomaDetail,
				})
			}

			evaders = append(evaders, Evader{
				SteamID:       r.SteamID,
				Name:          player.name,
				CheckID:       checkID,
				Filename:      check.Filename,
				BannedSteamID: banned.SteamID,
				BanReason:     banReason,
				BannedCount:   len(bannedAccounts),
				BannedDetails: details,
				ServerName:    getString(player.server, "site_name"),
				ServerIP:      getString(player.server, "ip"),
				ServerPort:    fmt.Sprintf("%v", player.server["port"]),
				DetectedAt:    time.Now().UTC().Format(time.RFC3339),
			})
		}
	}

	return evaders
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
	req.Header.Set("Referer", "https://fearproject.ru/")
	req.Header.Set("Origin", "https://fearproject.ru")
	if h.cfg.FearCookie != "" {
		cleaned := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(h.cfg.FearCookie, "\n", ""), "\r", ""))
		if cleaned != "" {
			req.Header.Set("Cookie", cleaned)
		}
	}

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

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func mustBool(v interface{}) bool {
	b, _ := v.(bool)
	return b
}

func mustInt(v interface{}) int {
	switch val := v.(type) {
	case float64:
		return int(val)
	case int:
		return val
	}
	return 0
}

func mustString(v interface{}) string {
	s, _ := v.(string)
	return s
}

func appendUnique(slice []string, s string) []string {
	for _, v := range slice {
		if v == s {
			return slice
		}
	}
	return append(slice, s)
}

func isStringInSlice(s string, slice []string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

func extractYoomaDetail(entry map[string]interface{}) *BanSourceDetail {
	if yb, _ := entry["yooma_banned"].(bool); !yb {
		return nil
	}
	reason, _ := entry["yooma_reason"].(string)
	if reason == "" {
		reason = "Yooma Ban"
	}
	return &BanSourceDetail{Reason: reason}
}

func detectBanReasonFromHistory(details []BannedDetail) string {
	for _, d := range details {
		if d.FearBan != nil {
			return d.FearBan.Reason
		}
	}
	if len(details) > 0 {
		return details[0].Bans
	}
	return "Banned"
}
