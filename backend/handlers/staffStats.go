package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

type StaffStatsHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewStaffStatsHandler(cfg *config.Config, db *database.DB) *StaffStatsHandler {
	return &StaffStatsHandler{cfg: cfg, db: db}
}

func (h *StaffStatsHandler) GetStaffStats(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	adminSteamIDs := r.URL.Query().Get("steamids")
	if adminSteamIDs == "" {
		http.Error(w, `{"error":"steamids required"}`, http.StatusBadRequest)
		return
	}

	ids := strings.Split(adminSteamIDs, ",")
	stats, err := h.db.GetStaffPunishmentStats(0)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	result := make(map[string]map[string]interface{})
	for _, sid := range ids {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			continue
		}
		entry := map[string]interface{}{
			"steamid":       sid,
			"total_bans":    0,
			"total_mutes":   0,
			"active_bans":   0,
			"active_mutes":  0,
			"removed_bans":  0,
			"removed_mutes": 0,
			"expired_bans":  0,
			"expired_mutes": 0,
			"name":          "",
			"avatar":        "",
		}
		if s, ok := stats[sid]; ok {
			entry["total_bans"] = s["bans"]
			entry["total_mutes"] = s["mutes"]
			entry["total"] = s["total"]
		}
		result[sid] = entry
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *StaffStatsHandler) GetPunishmentsByAdmin(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	adminSteamID := r.URL.Query().Get("admin_steamid")
	if adminSteamID == "" {
		http.Error(w, `{"error":"admin_steamid required"}`, http.StatusBadRequest)
		return
	}

	ptype, _ := strconv.Atoi(r.URL.Query().Get("type"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 100
	}

	punishments, err := h.db.GetPunishmentsByAdmin(adminSteamID, ptype, limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"punishments": punishments,
		"total":       len(punishments),
	})
}

func (h *StaffStatsHandler) GetPunishmentsTrend(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days <= 0 {
		days = 30
	}

	trend, err := h.db.GetPunishmentsTrend(days)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(trend)
}

func (h *StaffStatsHandler) GetPunishmentsMonthCompare(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	result, err := h.db.GetPunishmentsMonthCompare()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *StaffStatsHandler) GetPunishmentsList(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	ptype, _ := strconv.Atoi(r.URL.Query().Get("type"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 50
	}

	punishments, err := h.db.GetPunishmentsList(ptype, limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"punishments": punishments,
		"total":       len(punishments),
	})
}
