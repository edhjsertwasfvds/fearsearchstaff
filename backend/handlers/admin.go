package handlers

import (
	"encoding/json"
	"net/http"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

const OWNER_DISCORD_ID = "1500235583367417866"

type AdminHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewAdminHandler(cfg *config.Config, db *database.DB) *AdminHandler {
	return &AdminHandler{cfg: cfg, db: db}
}

func (h *AdminHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
	claims, _ := r.Context().Value(UserContextKey).(*JWTClaims)

	if h.db == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": []interface{}{}})
		return
	}

	users, err := h.db.GetAllUsers()
	if err != nil {
		http.Error(w, `{"error":"failed to fetch users"}`, http.StatusInternalServerError)
		return
	}

	result := make([]map[string]interface{}, 0)
	for _, u := range users {
		rp, ok := h.cfg.RoleMap[u.StaffGroup]
		level := u.Level
		roleName := u.StaffRole
		if ok {
			level = rp.Level
			roleName = rp.RoleName
		}

		isOwner := u.DiscordID == OWNER_DISCORD_ID
		isBlocked := level < 0 || u.StaffGroup == "UNDEFINED" || u.StaffGroup == "STAFF"

		result = append(result, map[string]interface{}{
			"discord_id":   u.DiscordID,
			"username":     u.Username,
			"display_name": u.DisplayName,
			"avatar":       u.Avatar,
			"staff_group":  u.StaffGroup,
			"staff_role":   roleName,
			"level":        level,
			"is_blocked":   isBlocked,
			"is_owner":     isOwner,
			"last_login":   u.LastLogin,
			"guild_roles":  u.GuildRoles,
		})
	}

	if claims != nil {
		isCallerOwner := claims.DiscordID == OWNER_DISCORD_ID
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":     true,
			"data":        result,
			"caller_id":   claims.DiscordID,
			"is_owner":    isCallerOwner,
			"caller_level": claims.Level,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
	})
}

func (h *AdminHandler) UpdateUserLevel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	claims, ok := r.Context().Value(UserContextKey).(*JWTClaims)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var req struct {
		DiscordID string `json:"discord_id"`
		Level     int    `json:"level"`
		Group     string `json:"group"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	if req.DiscordID == "" {
		http.Error(w, `{"error":"discord_id required"}`, http.StatusBadRequest)
		return
	}

	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	if req.DiscordID == OWNER_DISCORD_ID {
		http.Error(w, `{"error":"Нельзя изменить владельца"}`, http.StatusForbidden)
		return
	}

	targetUser, err := h.db.GetUserByDiscordID(req.DiscordID)
	if err != nil {
		http.Error(w, `{"error":"user not found"}`, http.StatusNotFound)
		return
	}

	targetLevel := targetUser.Level
	if rp, ok := h.cfg.RoleMap[targetUser.StaffGroup]; ok {
		targetLevel = rp.Level
	}

	if targetLevel >= 5 && claims.DiscordID != OWNER_DISCORD_ID {
		http.Error(w, `{"error":"Нельзя изменить пользователя LVL 5"}`, http.StatusForbidden)
		return
	}

	if claims.Level < 5 && claims.DiscordID != OWNER_DISCORD_ID {
		http.Error(w, `{"error":"Только LVL 5 может управлять пользователями"}`, http.StatusForbidden)
		return
	}

	user, err := h.db.GetUserByDiscordID(req.DiscordID)
	if err != nil {
		http.Error(w, `{"error":"user not found"}`, http.StatusNotFound)
		return
	}

	if req.Group != "" {
		user.StaffGroup = req.Group
		if rp, ok := h.cfg.RoleMap[req.Group]; ok {
			user.Level = rp.Level
			user.StaffRole = rp.RoleName
		} else {
			user.Level = req.Level
		}
	} else {
		user.Level = req.Level
	}

	if err := h.db.UpsertUser(user); err != nil {
		http.Error(w, `{"error":"failed to update user"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "User updated",
	})
}

func (h *AdminHandler) BlockUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	claims, ok := r.Context().Value(UserContextKey).(*JWTClaims)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var req struct {
		DiscordID string `json:"discord_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	if req.DiscordID == OWNER_DISCORD_ID {
		http.Error(w, `{"error":"Нельзя заблокировать владельца"}`, http.StatusForbidden)
		return
	}

	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	targetUser, err := h.db.GetUserByDiscordID(req.DiscordID)
	if err != nil {
		http.Error(w, `{"error":"user not found"}`, http.StatusNotFound)
		return
	}

	targetLevel := targetUser.Level
	if rp, ok := h.cfg.RoleMap[targetUser.StaffGroup]; ok {
		targetLevel = rp.Level
	}

	if targetLevel >= 5 && claims.DiscordID != OWNER_DISCORD_ID {
		http.Error(w, `{"error":"Нельзя заблокировать пользователя LVL 5"}`, http.StatusForbidden)
		return
	}

	targetUser.StaffGroup = "UNDEFINED"
	targetUser.Level = -1
	targetUser.StaffRole = "Заблокирован"
	if err := h.db.UpsertUser(targetUser); err != nil {
		http.Error(w, `{"error":"failed to block user"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "User blocked",
	})
}
