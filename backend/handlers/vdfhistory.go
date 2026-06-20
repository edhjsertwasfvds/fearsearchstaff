package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

// VDFCheckHistory — сжатая информация об одной VDF-проверке.
type VDFCheckHistory struct {
	ID            int      `json:"id"`
	Filename      string   `json:"filename"`
	Timestamp     string   `json:"timestamp"`
	LastRecheck   string   `json:"last_recheck,omitempty"`
	AttachmentURL string   `json:"attachment_url,omitempty"`
	MessageURL    string   `json:"message_url,omitempty"`
	Count         int      `json:"count"`
	BannedCount   int      `json:"banned_count"`
	SteamIDs      []string `json:"steamids"`
}

type vdfHistoryResult struct {
	SteamID      string                 `json:"steamid"`
	Nickname     string                 `json:"nickname"`
	FearBanned   bool                   `json:"fear_banned"`
	VacBanned    bool                   `json:"vac_banned"`
	GameBans     int                    `json:"game_bans"`
	CommunityBan bool                   `json:"community_ban"`
	YoomaData    map[string]interface{} `json:"yooma_data"`
}

func (r vdfHistoryResult) isBanned() bool {
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

type VDFHistoryHandler struct {
	cfg   *config.Config
	db    *database.DB
	cache *vdfHistoryCache
}

type vdfHistoryCache struct {
	mu        sync.RWMutex
	data      []VDFCheckHistory
	timestamp time.Time
}

func NewVDFHistoryHandler(cfg *config.Config, db *database.DB) *VDFHistoryHandler {
	return &VDFHistoryHandler{
		cfg:   cfg,
		db:    db,
		cache: &vdfHistoryCache{},
	}
}

func (h *VDFHistoryHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	h.cache.mu.RLock()
	if time.Since(h.cache.timestamp) < 30*time.Second && h.cache.data != nil {
		h.writeJSON(w, h.cache.data)
		h.cache.mu.RUnlock()
		return
	}
	h.cache.mu.RUnlock()

	history, err := h.computeHistory()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	h.cache.mu.Lock()
	h.cache.data = history
	h.cache.timestamp = time.Now()
	h.cache.mu.Unlock()

	h.writeJSON(w, history)
}

func (h *VDFHistoryHandler) writeJSON(w http.ResponseWriter, data []VDFCheckHistory) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

func (h *VDFHistoryHandler) computeHistory() ([]VDFCheckHistory, error) {
	// Сначала пытаемся получить из БД
	checks, err := h.db.GetVDFChecks()
	if err == nil && len(checks) > 0 {
		return h.buildHistoryFromDB(checks)
	}

	// Fallback на KV Store (старый формат)
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
		return []VDFCheckHistory{}, nil
	}

	ids := make([]int, 0, len(checksMap))
	for idStr := range checksMap {
		id, err := strconv.Atoi(idStr)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ids)))

	history := make([]VDFCheckHistory, 0, len(ids))
	for _, id := range ids {
		checkData, ok := checksMap[strconv.Itoa(id)].(map[string]interface{})
		if !ok {
			continue
		}

		results, ok := checkData["results"].([]interface{})
		if !ok {
			continue
		}

		banned := 0
		for _, r := range results {
			result, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			if h.isResultBanned(result) {
				banned++
			}
		}

		steamids := []string{}
		if sids, ok := checkData["steamids"].([]interface{}); ok {
			for _, sid := range sids {
				if s, ok := sid.(string); ok {
					steamids = append(steamids, s)
				}
			}
		}

		history = append(history, VDFCheckHistory{
			ID:            id,
			Filename:      getString(checkData, "filename"),
			Timestamp:     getString(checkData, "timestamp"),
			LastRecheck:   getString(checkData, "last_recheck"),
			AttachmentURL: getString(checkData, "attachment_url"),
			MessageURL:    getString(checkData, "message_url"),
			Count:         len(results),
			BannedCount:   banned,
			SteamIDs:      steamids,
		})
	}

	return history, nil
}

func (h *VDFHistoryHandler) buildHistoryFromDB(checks []database.VDFCheckData) ([]VDFCheckHistory, error) {
	history := make([]VDFCheckHistory, 0, len(checks))

	for _, check := range checks {
		var results []vdfHistoryResult
		if err := json.Unmarshal(check.Results, &results); err != nil {
			continue
		}

		banned := 0
		for _, r := range results {
			if r.isBanned() {
				banned++
			}
		}

		lastRecheck := ""
		if check.LastRecheck != nil {
			lastRecheck = check.LastRecheck.Format(time.RFC3339)
		}

		history = append(history, VDFCheckHistory{
			ID:            check.CheckID,
			Filename:      check.Filename,
			Timestamp:     check.Timestamp.Format(time.RFC3339),
			LastRecheck:   lastRecheck,
			AttachmentURL: check.AttachmentURL,
			MessageURL:    check.MessageURL,
			Count:         len(results),
			BannedCount:   banned,
			SteamIDs:      check.SteamIDs,
		})
	}

	// Сортируем по ID в обратном порядке
	sort.Slice(history, func(i, j int) bool {
		return history[i].ID > history[j].ID
	})

	return history, nil
}

func (h *VDFHistoryHandler) isResultBanned(result map[string]interface{}) bool {
	if fearBanned, ok := result["fear_banned"].(bool); ok && fearBanned {
		return true
	}
	if vacBanned, ok := result["vac_banned"].(bool); ok && vacBanned {
		return true
	}
	if communityBan, ok := result["community_ban"].(bool); ok && communityBan {
		return true
	}
	if gameBans, ok := result["game_bans"].(float64); ok && gameBans > 0 {
		return true
	}
	if yoomaData, ok := result["yooma_data"].(map[string]interface{}); ok {
		if found, ok := yoomaData["found"].(bool); ok && found {
			return true
		}
		if punishments, ok := yoomaData["punishments"].([]interface{}); ok {
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
	}
	return false
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

