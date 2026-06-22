package ws

import (
	"encoding/json"
	"log"
	"sync"
)

type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]bool
_broadcast chan []byte
}

var DefaultHub = &Hub{
	clients:   make(map[*Client]bool),
	_broadcast: make(chan []byte, 256),
}

func (h *Hub) Run() {
	for msg := range h._broadcast {
		h.mu.RLock()
		for client := range h.clients {
			select {
			case client.send <- msg:
			default:
				close(client.send)
				delete(h.clients, client)
			}
		}
		h.mu.RUnlock()
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()
	log.Printf("WS: client connected (%d total)", h.ClientCount())
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
	log.Printf("WS: client disconnected (%d total)", h.ClientCount())
}

func (h *Hub) BroadcastJSON(data interface{}) {
	raw, err := json.Marshal(data)
	if err != nil {
		log.Printf("WS: marshal error: %v", err)
		return
	}
	select {
	case h._broadcast <- raw:
	default:
		log.Println("WS: broadcast channel full, dropping message")
	}
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
