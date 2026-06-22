package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

type ServerActivityHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewServerActivityHandler(cfg *config.Config, db *database.DB) *ServerActivityHandler {
	return &ServerActivityHandler{cfg: cfg, db: db}
}

func (h *ServerActivityHandler) GetActivity(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	hours, _ := strconv.Atoi(r.URL.Query().Get("hours"))
	if hours <= 0 || hours > 168 {
		hours = 24
	}

	data, err := h.db.GetServerActivity(hours)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":  data,
		"total": len(data),
		"hours": hours,
	})
}

func (h *ServerActivityHandler) GetSummary(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	summary, err := h.db.GetServerActivitySummary()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}
