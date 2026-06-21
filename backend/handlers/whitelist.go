package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

type WhitelistHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewWhitelistHandler(cfg *config.Config, db *database.DB) *WhitelistHandler {
	return &WhitelistHandler{cfg: cfg, db: db}
}

func (h *WhitelistHandler) GetEntries(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data":    []interface{}{},
			"total":   0,
		})
		return
	}

	entries, err := h.db.GetWhitelist()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	type entryJSON struct {
		ID      string `json:"id"`
		SteamID string `json:"steam_id"`
		Name    string `json:"name"`
		AddedBy string `json:"added_by"`
		Date    string `json:"date"`
	}

	result := make([]entryJSON, 0, len(entries))
	for _, e := range entries {
		result = append(result, entryJSON{
			ID:      e.SteamID,
			SteamID: e.SteamID,
			Name:    e.Name,
			AddedBy: e.AddedBy,
			Date:    e.Date,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
		"total":   len(result),
	})
}

func (h *WhitelistHandler) AddEntry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	claims, _ := r.Context().Value(UserContextKey).(*JWTClaims)
	if claims == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var req struct {
		SteamID string `json:"steam_id"`
		Name    string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	if req.SteamID == "" {
		http.Error(w, `{"error":"steam_id required"}`, http.StatusBadRequest)
		return
	}

	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	if err := h.db.UpsertWhitelist(req.SteamID, req.Name, claims.Username); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"steam_id": req.SteamID,
			"name":     req.Name,
			"added_by": claims.Username,
		},
	})
}

func (h *WhitelistHandler) DeleteEntry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	if err := h.db.DeleteWhitelist(req.ID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Entry removed",
	})
}
