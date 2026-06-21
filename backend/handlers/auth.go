package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"fearstaff-api/config"
	"fearstaff-api/database"
	"fearstaff-api/models"
)

type AuthHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewAuthHandler(cfg *config.Config, db *database.DB) *AuthHandler {
	return &AuthHandler{cfg: cfg, db: db}
}

func (h *AuthHandler) LoginURL(w http.ResponseWriter, r *http.Request) {
	state := fmt.Sprintf("%d", time.Now().UnixNano())
	url := fmt.Sprintf(
		"https://discord.com/api/oauth2/authorize?client_id=%s&redirect_uri=%s&response_type=code&scope=identify+email+guilds.members.read&state=%s",
		h.cfg.DiscordClientID,
		urlEncode(h.cfg.DiscordRedirectURL),
		state,
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"url":   url,
		"state": state,
	})
}

func (h *AuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, `{"error":"missing code"}`, http.StatusBadRequest)
		return
	}

	accessToken, err := h.exchangeCode(code)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"token exchange failed: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	discordUser, err := h.fetchDiscordUser(accessToken)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to fetch user: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	guildRoles, err := h.fetchGuildRolesWithToken(accessToken, discordUser.ID)
	if err != nil {
		fmt.Printf("⚠️ Could not fetch guild roles with OAuth token: %v\n", err)
		guildRoles, err = h.fetchGuildRoles(discordUser.ID)
		if err != nil {
			fmt.Printf("⚠️ Could not fetch guild roles with Bot token: %v\n", err)
			guildRoles = []string{}
		}
	}

	roleName, staffGroup, level, permissions := h.resolvePermissions(guildRoles)

	user := &models.User{
		DiscordID:   discordUser.ID,
		Username:    discordUser.Username,
		DisplayName: discordUser.GlobalName,
		Avatar:      discordUser.Avatar,
		Email:       discordUser.Email,
		StaffRole:   roleName,
		StaffGroup:  staffGroup,
		Level:       level,
		Permissions: permissions,
		GuildRoles:  guildRoles,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
		LastLogin:   time.Now().UTC(),
	}

	if h.db != nil {
		if err := h.db.UpsertUser(user); err != nil {
			fmt.Printf("⚠️ DB upsert error: %v\n", err)
		}
	}

	jwtToken, err := GenerateJWT(h.cfg, user.DiscordID, user.Username, user.StaffGroup, user.Level, user.Permissions)
	if err != nil {
		http.Error(w, `{"error":"jwt generation failed"}`, http.StatusInternalServerError)
		return
	}

	if h.db != nil {
		h.db.LogLogin(user.DiscordID, r.RemoteAddr, r.UserAgent())
	}

	frontURL := h.cfg.FrontendURL
	http.Redirect(w, r, fmt.Sprintf("%s/auth/callback?token=%s", frontURL, jwtToken), http.StatusFound)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(UserContextKey).(*JWTClaims)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var user *models.User
	if h.db != nil {
		u, err := h.db.GetUserByDiscordID(claims.DiscordID)
		if err == nil {
			user = u
		}
	}
	if user == nil {
		user = &models.User{
			DiscordID:   claims.DiscordID,
			Username:    claims.Username,
			StaffGroup:  claims.StaffGroup,
			Level:       claims.Level,
			Permissions: claims.Permissions,
		}
	}

	guildRoles, fetchErr := h.fetchGuildRoles(user.DiscordID)
	if fetchErr == nil && len(guildRoles) > 0 {
		roleName, staffGroup, level, permissions := h.resolvePermissions(guildRoles)
		user.StaffRole = roleName
		user.StaffGroup = staffGroup
		user.Level = level
		user.Permissions = permissions
		user.GuildRoles = guildRoles
		user.UpdatedAt = time.Now().UTC()
		if h.db != nil {
			_ = h.db.UpsertUser(user)
		}
	} else {
		if user.Level == 0 && user.StaffGroup == "" {
			user.Level = claims.Level
			user.StaffGroup = claims.StaffGroup
			user.Permissions = claims.Permissions
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    user,
	})
}

func (h *AuthHandler) exchangeCode(code string) (string, error) {
	data := fmt.Sprintf(
		"client_id=%s&client_secret=%s&grant_type=authorization_code&code=%s&redirect_uri=%s",
		h.cfg.DiscordClientID,
		h.cfg.DiscordClientSecret,
		code,
		urlEncode(h.cfg.DiscordRedirectURL),
	)

	req, _ := http.NewRequest("POST", "https://discord.com/api/oauth2/token", strings.NewReader(data))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("discord returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	return result.AccessToken, nil
}

func (h *AuthHandler) fetchDiscordUser(token string) (*models.DiscordUser, error) {
	req, _ := http.NewRequest("GET", "https://discord.com/api/users/@me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var user models.DiscordUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}
	return &user, nil
}

func (h *AuthHandler) guildIDs() []string {
	ids := []string{}
	if h.cfg.DiscordGuildID != "" {
		ids = append(ids, h.cfg.DiscordGuildID)
	}
	for _, g := range h.cfg.DiscordExtraGuildIDs {
		if g != "" {
			ids = append(ids, g)
		}
	}
	return ids
}

func (h *AuthHandler) fetchGuildRoles(userID string) ([]string, error) {
	guildIDs := h.guildIDs()
	if len(guildIDs) == 0 {
		return nil, fmt.Errorf("guild ID not configured")
	}

	botToken := h.cfg.DiscordBotToken
	if botToken == "" {
		botToken = h.cfg.DiscordClientSecret
	}

	var allRoles []string
	for _, guildID := range guildIDs {
		roles, err := h.fetchGuildRolesForGuild(userID, guildID, botToken, "Bot ")
		if err == nil {
			allRoles = append(allRoles, roles...)
		}
	}

	if len(allRoles) == 0 {
		return nil, fmt.Errorf("no guild roles found")
	}
	return allRoles, nil
}

func (h *AuthHandler) fetchGuildRolesWithToken(accessToken string, userID string) ([]string, error) {
	guildIDs := h.guildIDs()
	if len(guildIDs) == 0 {
		return nil, fmt.Errorf("guild ID not configured")
	}

	var allRoles []string
	for _, guildID := range guildIDs {
		roles, err := h.fetchGuildRolesForGuild(userID, guildID, accessToken, "Bearer ")
		if err == nil {
			allRoles = append(allRoles, roles...)
		}
	}

	if len(allRoles) == 0 {
		return nil, fmt.Errorf("no guild roles found")
	}
	return allRoles, nil
}

func (h *AuthHandler) fetchGuildRolesForGuild(userID, guildID, token, prefix string) ([]string, error) {
	url := fmt.Sprintf("https://discord.com/api/guilds/%s/members/%s", guildID, userID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", prefix+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var member models.DiscordGuildMember
	if err := json.NewDecoder(resp.Body).Decode(&member); err != nil {
		return nil, err
	}
	return member.Roles, nil
}

func (h *AuthHandler) resolvePermissions(guildRoles []string) (string, string, int, []string) {
	roleSet := make(map[string]bool)
	for _, r := range guildRoles {
		roleSet[r] = true
	}

	var bestGroup string
	var bestLevel int
	var bestPermissions []string
	var bestRoleName string

	for groupName, rp := range h.cfg.RoleMap {
		if rp.RoleID == "" {
			continue
		}
		if roleSet[rp.RoleID] && rp.Level > bestLevel {
			bestGroup = groupName
			bestLevel = rp.Level
			bestPermissions = rp.Permissions
			bestRoleName = rp.RoleName
		}
	}

	if bestLevel <= 0 && bestGroup == "" {
		if roleSet == nil || len(roleSet) == 0 {
			return "", "STAFF", -1, []string{}
		}
		for _, checkerRoleID := range h.cfg.CheckerRoleIDs {
			if roleSet[checkerRoleID] {
				return "Checker", "CHECKER", 1, []string{"vdf.view"}
			}
		}
		for groupName, rp := range h.cfg.RoleMap {
			if rp.RoleID == "" && groupName == "UNDEFINED" {
				if roleSet[rp.RoleID] {
					return rp.RoleName, groupName, rp.Level, []string{}
				}
			}
		}
		return "", "STAFF", -1, []string{}
	}

	return bestRoleName, bestGroup, bestLevel, bestPermissions
}

func urlEncode(s string) string {
	return strings.NewReplacer(
		":", "%3A",
		"/", "%2F",
		"?", "%3F",
		"&", "%26",
		"=", "%3D",
	).Replace(s)
}
