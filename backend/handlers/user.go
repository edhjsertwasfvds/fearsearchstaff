package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

type UserHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewUserHandler(cfg *config.Config, db *database.DB) *UserHandler {
	return &UserHandler{cfg: cfg, db: db}
}

func (h *UserHandler) GetStaff(w http.ResponseWriter, r *http.Request) {
	result := make([]map[string]interface{}, 0)

	if h.db != nil {
		users, err := h.db.GetAllUsers()
		if err == nil {
			for _, u := range users {
				if u.Level < 1 {
					continue
				}
				rp, ok := h.cfg.RoleMap[u.StaffGroup]
				level := u.Level
				roleName := u.StaffRole
				if ok {
					level = rp.Level
					roleName = rp.RoleName
				}
				result = append(result, map[string]interface{}{
					"steam_id":     u.SteamID,
					"name":         u.DisplayName,
					"discord_id":   u.DiscordID,
					"discord_name": u.Username,
					"role":         roleName,
					"group_name":   u.StaffGroup,
					"level":        level,
					"updated_at":   u.UpdatedAt,
				})
			}
		}
	}

	if len(result) == 0 && h.db != nil {
		staffList, err := h.db.GetStaffListFromDB()
		if err == nil && len(staffList) > 0 {
			for _, s := range staffList {
				gn, _ := s["group_name"].(string)
				rp, _ := h.cfg.RoleMap[gn]
				gdn, _ := s["group_display_name"].(string)
				result = append(result, map[string]interface{}{
					"steam_id":     s["steamid"],
					"name":         s["name"],
					"discord_id":   s["discord_id"],
					"discord_name": s["discord_nickname"],
					"role":         gdn,
					"group_name":   gn,
					"level":        rp.Level,
				})
			}
		}
	}

	if len(result) == 0 {
		staff, err := h.db.GetStaffFromFile()
		if err == nil {
			for _, s := range staff {
				rp, ok := h.cfg.RoleMap[s.GroupName]
				level := 0
				if ok {
					level = rp.Level
				}
				result = append(result, map[string]interface{}{
					"steam_id":     s.SteamID,
					"name":         s.Name,
					"discord_id":   s.DiscordID,
					"discord_name": s.DiscordName,
					"role":         s.Role,
					"group_name":   s.GroupName,
					"level":        level,
					"updated_at":   s.UpdatedAt,
				})
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
	})
}

func (h *UserHandler) GetStaffByGroup(w http.ResponseWriter, r *http.Request) {
	group := r.URL.Query().Get("group")
	if group == "" {
		http.Error(w, `{"error":"group parameter required"}`, http.StatusBadRequest)
		return
	}

	staff, err := h.db.GetStaffFromFile()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data":    []interface{}{},
		})
		return
	}

	result := make([]map[string]interface{}, 0)
	for _, s := range staff {
		if s.GroupName == group {
			rp, _ := h.cfg.RoleMap[s.GroupName]
			result = append(result, map[string]interface{}{
				"steam_id":     s.SteamID,
				"name":         s.Name,
				"discord_id":   s.DiscordID,
				"discord_name": s.DiscordName,
				"role":         s.Role,
				"group_name":   s.GroupName,
				"level":        rp.Level,
				"updated_at":   s.UpdatedAt,
			})
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
	})
}

func (h *UserHandler) GetRoles(w http.ResponseWriter, r *http.Request) {
	roles := make([]map[string]interface{}, 0)
	for name, rp := range h.cfg.RoleMap {
		if name == "UNDEFINED" {
			continue
		}
		roles = append(roles, map[string]interface{}{
			"key":         name,
			"name":        rp.RoleName,
			"level":       rp.Level,
			"permissions": rp.Permissions,
		})
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    roles,
	})
}

func (h *UserHandler) GetDashboardStats(w http.ResponseWriter, r *http.Request) {
	total := 0

	if h.db != nil {
		users, err := h.db.GetAllUsers()
		if err == nil {
			for _, u := range users {
				if u.Level >= 1 {
					total++
				}
			}
		}
	}

	if total == 0 {
		staff, err := h.db.GetStaffFromFile()
		if err == nil {
			total = len(staff)
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"total_staff":   total,
			"staff_by_role": map[string]int{},
		},
	})
}

func (h *UserHandler) GetAllUsers(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	users, err := h.db.GetAllUsers()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	if len(users) > limit {
		users = users[:limit]
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    users,
	})
}
