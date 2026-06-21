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
	ID            int               `json:"id"`
	Filename      string            `json:"filename"`
	Timestamp     string            `json:"timestamp"`
	LastRecheck   string            `json:"last_recheck,omitempty"`
	AttachmentURL string            `json:"attachment_url,omitempty"`
	MessageURL    string            `json:"message_url,omitempty"`
	Count         int               `json:"count"`
	BannedCount   int               `json:"banned_count"`
	SteamIDs      []string          `json:"steamids"`
	Results       []VDFHistoryItem  `json:"results"`
}

type VDFHistoryItem struct {
	SteamID     string `json:"steamid"`
	Nickname    string `json:"nickname"`
	FearBanned  bool   `json:"fear_banned"`
	FearReason  string `json:"fear_reason"`
	FearUnban   string `json:"fear_unban"`
	VacBanned   bool   `json:"vac_banned"`
	GameBans    int    `json:"game_bans"`
	CommunityBan bool  `json:"community_ban"`
	YoomaBanned bool   `json:"yooma_banned"`
	YoomaReason string `json:"yooma_reason"`
}

type vdfHistoryStore struct {
	Checks map[string]struct {
		Results       []vdfHistoryResult `json:"results"`
		Filename      string             `json:"filename"`
		Timestamp     string             `json:"timestamp"`
		AttachmentURL string             `json:"attachment_url"`
		MessageURL    string             `json:"message_url"`
		Steamids      []string           `json:"steamids"`
		LastRecheck   string             `json:"last_recheck"`
	} `json:"checks"`
}

type vdfHistoryResult struct {
	SteamID      string                 `json:"steamid"`
	Nickname     string                 `json:"nickname"`
	FearBanned   bool                   `json:"fear_banned"`
	FearReason   string                 `json:"fear_reason"`
	FearUnban    string                 `json:"fear_unban"`
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
	if h.db == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": []interface{}{}})
		return
	}

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
	// Способ 1: из PostgreSQL vdf_history
	if h.db != nil {
		history, err := h.db.GetVDFHistoryDetailed(200)
		if err == nil && len(history) > 0 {
			return h.buildHistoryFromDB(history), nil
		}
	}

	// Способ 2: fallback на KV store
	vdfData, err := h.db.GetKVStore("vdf_checks.json")
	if err != nil {
		return nil, fmt.Errorf("failed to read vdf checks: %w", err)
	}

	var store vdfHistoryStore
	if err := json.Unmarshal(vdfData, &store); err != nil {
		return nil, fmt.Errorf("failed to parse vdf checks: %w", err)
	}

	ids := make([]int, 0, len(store.Checks))
	for idStr := range store.Checks {
		id, err := strconv.Atoi(idStr)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ids)))

	history := make([]VDFCheckHistory, 0, len(ids))
	for _, id := range ids {
		check := store.Checks[strconv.Itoa(id)]
		banned := 0
		results := make([]VDFHistoryItem, 0, len(check.Results))
		for _, r := range check.Results {
			yoomaBanned := false
			yoomaReason := ""
			if r.YoomaData != nil {
				if found, _ := r.YoomaData["found"].(bool); found {
					if punishments, ok := r.YoomaData["punishments"].([]interface{}); ok && len(punishments) > 0 {
						for _, p := range punishments {
							pm, ok := p.(map[string]interface{})
							if !ok {
								continue
							}
							if status, _ := pm["status"].(string); status == "active" {
								yoomaBanned = true
								reason, _ := pm["reason"].(string)
								if reason == "" {
									reason = "Haron Anti-Cheats"
								}
								yoomaReason = reason
								break
							}
						}
					}
				}
			}
			results = append(results, VDFHistoryItem{
				SteamID:      r.SteamID,
				Nickname:     r.Nickname,
				FearBanned:   r.FearBanned,
				FearReason:   r.FearReason,
				FearUnban:    r.FearUnban,
				VacBanned:    r.VacBanned,
				GameBans:     r.GameBans,
				CommunityBan: r.CommunityBan,
				YoomaBanned:  yoomaBanned,
				YoomaReason:  yoomaReason,
			})
			if r.isBanned() {
				banned++
			}
		}
		steamids := check.Steamids
		if len(steamids) == 0 {
			steamids = make([]string, 0, len(check.Results))
			for _, r := range check.Results {
				if r.SteamID != "" {
					steamids = append(steamids, r.SteamID)
				}
			}
		}
		history = append(history, VDFCheckHistory{
			ID:            id,
			Filename:      check.Filename,
			Timestamp:     check.Timestamp,
			LastRecheck:   check.LastRecheck,
			AttachmentURL: check.AttachmentURL,
			MessageURL:    check.MessageURL,
			Count:         len(check.Results),
			BannedCount:   banned,
			SteamIDs:      steamids,
			Results:       results,
		})
	}

	return history, nil
}

func (h *VDFHistoryHandler) buildHistoryFromDB(rows []map[string]interface{}) []VDFCheckHistory {
	type checkGroup struct {
		filename   string
		checkID    int
		timestamp  string
		results    []VDFHistoryItem
	}

	groups := make(map[int]*checkGroup)
	groupOrder := make([]int, 0)

	for _, row := range rows {
		checkID := 0
		if v, ok := row["check_id"].(float64); ok {
			checkID = int(v)
		}
		if v, ok := row["check_id"].(int); ok {
			checkID = v
		}

		if _, exists := groups[checkID]; !exists {
			filename, _ := row["filename"].(string)
			createdAt, _ := row["created_at"].(string)
			groups[checkID] = &checkGroup{
				filename:  filename,
				checkID:   checkID,
				timestamp: createdAt,
			}
			groupOrder = append(groupOrder, checkID)
		}

		g := groups[checkID]
		g.results = append(g.results, VDFHistoryItem{
			SteamID:     mustString(row["steamid"]),
			Nickname:    mustString(row["nickname"]),
			FearBanned:  mustBool(row["fear_banned"]),
			FearReason:  mustString(row["fear_reason"]),
			FearUnban:   mustString(row["fear_unban_time"]),
			VacBanned:   mustBool(row["vac_banned"]),
			GameBans:    mustInt(row["game_bans"]),
			YoomaBanned: mustBool(row["yooma_banned"]),
			YoomaReason: mustString(row["yooma_reason"]),
		})
	}

	sort.Sort(sort.Reverse(sort.IntSlice(groupOrder)))

	history := make([]VDFCheckHistory, 0, len(groupOrder))
	for _, checkID := range groupOrder {
		g := groups[checkID]
		banned := 0
		steamids := make([]string, 0, len(g.results))
		for _, r := range g.results {
			steamids = append(steamids, r.SteamID)
			if r.FearBanned || r.VacBanned || r.GameBans > 0 || r.YoomaBanned {
				banned++
			}
		}
		history = append(history, VDFCheckHistory{
			ID:          checkID,
			Filename:    g.filename,
			Timestamp:   g.timestamp,
			Count:       len(g.results),
			BannedCount: banned,
			SteamIDs:    steamids,
			Results:     g.results,
		})
	}

	return history
}
