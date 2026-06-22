package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"fearstaff-api/config"
	"fearstaff-api/database"
	"fearstaff-api/ws"
)

type BotSnapshotHandler struct {
	cfg    *config.Config
	db     *database.DB
	mu     sync.Mutex
	lastAt time.Time
}

func NewBotSnapshotHandler(cfg *config.Config, db *database.DB) *BotSnapshotHandler {
	return &BotSnapshotHandler{cfg: cfg, db: db}
}

type SnapshotRequest struct {
	Secret    string      `json:"secret"`
	Players   interface{} `json:"players"`
	Total     int         `json:"total"`
	Servers   interface{} `json:"servers"`
	Timestamp int64       `json:"timestamp"`
}

func (h *BotSnapshotHandler) ReceiveSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	secret := os.Getenv("SITE_API_SECRET")
	if secret == "" {
		secret = "default_secret"
	}

	var req SnapshotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	if req.Secret != secret {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	h.mu.Lock()
	h.lastAt = time.Now()
	h.mu.Unlock()

	// Broadcast to all WebSocket clients
	msg := map[string]interface{}{
		"type":    "all_players",
		"players": req.Players,
		"total":   req.Total,
		"servers": req.Servers,
		"time":    req.Timestamp,
	}
	ws.DefaultHub.BroadcastJSON(msg)

	log.Printf("WS: Snapshot received — %d players, broadcast to %d clients", req.Total, ws.DefaultHub.ClientCount())

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"clients": ws.DefaultHub.ClientCount(),
	})
}

func (h *BotSnapshotHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	lastAt := h.lastAt
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"clients":    ws.DefaultHub.ClientCount(),
		"last_sync":  lastAt.Format(time.RFC3339),
	})
}
