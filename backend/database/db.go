package database

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"fearstaff-api/models"
)

type DB struct {
	pool      *pgxpool.Pool
	staffFile string
	mu        sync.RWMutex
}

func New(databaseURL string) (*DB, error) {
	if databaseURL == "" {
		log.Println("⚠️ DATABASE_URL not set, using JSON file fallback")
		return &DB{
			staffFile: "staff_db.json",
		}, nil
	}

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	db := &DB{pool: pool, staffFile: "staff_db.json"}

	if err := db.migrate(); err != nil {
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	return db, nil
}

func (db *DB) migrate() error {
	ctx := context.Background()
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id SERIAL PRIMARY KEY,
			discord_id VARCHAR(64) UNIQUE NOT NULL,
			username VARCHAR(255) NOT NULL,
			display_name VARCHAR(255),
			avatar TEXT,
			email VARCHAR(255),
			staff_group VARCHAR(64),
			staff_role VARCHAR(128),
			steam_id VARCHAR(64),
			level INTEGER DEFAULT 0,
			permissions JSONB DEFAULT '[]',
			guild_roles JSONB DEFAULT '[]',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			last_login TIMESTAMPTZ
		)`,
		`CREATE TABLE IF NOT EXISTS login_history (
			id SERIAL PRIMARY KEY,
			discord_id VARCHAR(64) NOT NULL,
			ip_address VARCHAR(64),
			user_agent TEXT,
			logged_in_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS kv_store (
			key TEXT PRIMARY KEY,
			value JSONB NOT NULL,
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS whitelist (
			id SERIAL PRIMARY KEY,
			steam_id VARCHAR(64) UNIQUE NOT NULL,
			name VARCHAR(255),
			added_by VARCHAR(255),
			added_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS profile_cache (
			steam_id VARCHAR(64) PRIMARY KEY,
			name VARCHAR(255),
			avatar TEXT,
			fetched_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS staff_list (
			steam_id VARCHAR(64) PRIMARY KEY,
			name VARCHAR(255),
			nickname VARCHAR(255),
			discord_id VARCHAR(64),
			discord_name VARCHAR(255),
			group_name VARCHAR(64),
			group_display_name VARCHAR(128),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS vdf_checks (
			id SERIAL PRIMARY KEY,
			check_id INTEGER UNIQUE,
			filename VARCHAR(255),
			timestamp TIMESTAMPTZ DEFAULT NOW(),
			attachment_url TEXT,
			message_url TEXT,
			results JSONB DEFAULT '[]',
			steamids TEXT[] DEFAULT '{}',
			banned_count INTEGER DEFAULT 0,
			last_recheck TIMESTAMPTZ
		)`,
		`CREATE TABLE IF NOT EXISTS app_logs (
			id SERIAL PRIMARY KEY,
			service VARCHAR(64),
			level VARCHAR(16),
			message TEXT,
			data JSONB,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
	}

	for _, q := range queries {
		if _, err := db.pool.Exec(ctx, q); err != nil {
			return fmt.Errorf("migration query failed: %w\nQuery: %s", err, q)
		}
	}
	log.Println("✅ Database migration completed")
	return nil
}

func (db *DB) Close() {
	if db.pool != nil {
		db.pool.Close()
	}
}

func (db *DB) UpsertUser(user *models.User) error {
	if db.pool == nil {
		return db.upsertUserJSON(user)
	}

	ctx := context.Background()
	permJSON, _ := json.Marshal(user.Permissions)
	rolesJSON, _ := json.Marshal(user.GuildRoles)

	_, err := db.pool.Exec(ctx, `
		INSERT INTO users (discord_id, username, display_name, avatar, email, staff_group, staff_role, steam_id, level, permissions, guild_roles, created_at, updated_at, last_login)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (discord_id) DO UPDATE SET
			username = EXCLUDED.username,
			display_name = EXCLUDED.display_name,
			avatar = EXCLUDED.avatar,
			email = EXCLUDED.email,
			staff_group = EXCLUDED.staff_group,
			staff_role = EXCLUDED.staff_role,
			steam_id = EXCLUDED.steam_id,
			level = EXCLUDED.level,
			permissions = EXCLUDED.permissions,
			guild_roles = EXCLUDED.guild_roles,
			updated_at = NOW(),
			last_login = NOW()
	`,
		user.DiscordID, user.Username, user.DisplayName, user.Avatar, user.Email,
		user.StaffGroup, user.StaffRole, user.SteamID, user.Level,
		permJSON, rolesJSON, user.CreatedAt, user.UpdatedAt, user.LastLogin,
	)
	return err
}

func (db *DB) GetUserByDiscordID(discordID string) (*models.User, error) {
	if db.pool == nil {
		return db.getUserByDiscordIDJSON(discordID)
	}

	ctx := context.Background()
	var user models.User
	var permJSON, rolesJSON []byte

	err := db.pool.QueryRow(ctx, `
		SELECT discord_id, username, display_name, avatar, email, staff_group, staff_role, steam_id, level, permissions, guild_roles, created_at, updated_at, last_login
		FROM users WHERE discord_id = $1
	`, discordID).Scan(
		&user.DiscordID, &user.Username, &user.DisplayName, &user.Avatar,
		&user.Email, &user.StaffGroup, &user.StaffRole, &user.SteamID,
		&user.Level, &permJSON, &rolesJSON, &user.CreatedAt, &user.UpdatedAt, &user.LastLogin,
	)
	if err != nil {
		return nil, err
	}

	_ = json.Unmarshal(permJSON, &user.Permissions)
	_ = json.Unmarshal(rolesJSON, &user.GuildRoles)
	return &user, nil
}

func (db *DB) GetAllUsers() ([]models.User, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database available")
	}

	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT discord_id, username, display_name, avatar, staff_group, staff_role, steam_id, level, permissions, guild_roles, last_login
		FROM users ORDER BY last_login DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		var permJSON, rolesJSON []byte
		_ = rows.Scan(
			&u.DiscordID, &u.Username, &u.DisplayName, &u.Avatar,
			&u.StaffGroup, &u.StaffRole, &u.SteamID, &u.Level,
			&permJSON, &rolesJSON, &u.LastLogin,
		)
		_ = json.Unmarshal(permJSON, &u.Permissions)
		_ = json.Unmarshal(rolesJSON, &u.GuildRoles)
		users = append(users, u)
	}
	return users, nil
}

func (db *DB) LogLogin(discordID, ip, userAgent string) {
	if db.pool == nil {
		return
	}
	ctx := context.Background()
	_, _ = db.pool.Exec(ctx, `
		INSERT INTO login_history (discord_id, ip_address, user_agent) VALUES ($1, $2, $3)
	`, discordID, ip, userAgent)
}

func (db *DB) SearchSteamIDs(query string) ([]string, error) {
	if db.pool == nil {
		return db.searchSteamIDsJSON(query)
	}
	ctx := context.Background()
	q := "%" + query + "%"

	ids := make([]string, 0)

	rows, err := db.pool.Query(ctx, `
		SELECT DISTINCT steam_id FROM users
		WHERE (steam_id ILIKE $1 OR discord_id ILIKE $1 OR username ILIKE $1 OR display_name ILIKE $1)
		AND steam_id IS NOT NULL AND steam_id != ''
	`, q)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sid string
			if err := rows.Scan(&sid); err == nil && sid != "" {
				ids = append(ids, sid)
			}
		}
	}

	if len(ids) == 0 {
		rows2, err2 := db.pool.Query(ctx, `
			SELECT DISTINCT steam_id FROM staff_list
			WHERE (steam_id ILIKE $1 OR name ILIKE $1 OR nickname ILIKE $1 OR discord_id ILIKE $1 OR discord_name ILIKE $1)
			AND steam_id IS NOT NULL AND steam_id != ''
		`, q)
		if err2 == nil {
			defer rows2.Close()
			for rows2.Next() {
				var sid string
				if err := rows2.Scan(&sid); err == nil && sid != "" {
					ids = append(ids, sid)
				}
			}
		}
	}

	return ids, nil
}

func (db *DB) GetKVStore(key string) ([]byte, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database available")
	}
	ctx := context.Background()
	var value []byte
	err := db.pool.QueryRow(ctx, `SELECT value FROM kv_store WHERE key = $1`, key).Scan(&value)
	if err != nil {
		return nil, err
	}
	return value, nil
}

func (db *DB) SetKVStore(key string, value []byte) error {
	if db.pool == nil {
		return fmt.Errorf("no database available")
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, key, value)
	return err
}

func (db *DB) UpsertStaffList(staff []map[string]interface{}) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()

	for _, s := range staff {
		sid := ""
		if v, ok := s["steamid"].(string); ok {
			sid = v
		} else if v, ok := s["steam_id"].(string); ok {
			sid = v
		}
		if sid == "" {
			continue
		}
		name := getString(s, "name")
		nickname := getString(s, "nickname")
		discordID := fmt.Sprintf("%v", s["discord_id"])
		discordName := getString(s, "discord_nickname")
		groupName := getString(s, "group_name")
		groupDisplayName := getString(s, "group_display_name")

		_, err := db.pool.Exec(ctx, `
			INSERT INTO staff_list (steam_id, name, nickname, discord_id, discord_name, group_name, group_display_name, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
			ON CONFLICT (steam_id) DO UPDATE SET
				name = EXCLUDED.name, nickname = EXCLUDED.nickname,
				discord_id = EXCLUDED.discord_id, discord_name = EXCLUDED.discord_name,
				group_name = EXCLUDED.group_name, group_display_name = EXCLUDED.group_display_name,
				updated_at = NOW()
		`, sid, name, nickname, discordID, discordName, groupName, groupDisplayName)
		if err != nil {
			log.Printf("⚠️ UpsertStaffList error for %s: %v", sid, err)
		}
	}
	return nil
}

func (db *DB) GetStaffListFromDB() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steam_id, name, nickname, discord_id, discord_name, group_name, group_display_name FROM staff_list
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var steamID, name, nickname, discordID, discordName, groupName, groupDisplayName string
		if err := rows.Scan(&steamID, &name, &nickname, &discordID, &discordName, &groupName, &groupDisplayName); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"steamid":             steamID,
			"name":                name,
			"nickname":            nickname,
			"discord_id":          discordID,
			"discord_nickname":    discordName,
			"group_name":          groupName,
			"group_display_name":  groupDisplayName,
		})
	}
	return result, nil
}

func (db *DB) GetProfilesBatch(steamIDs []string) (map[string]ProfileCache, error) {
	if db.pool == nil || len(steamIDs) == 0 {
		return nil, nil
	}
	ctx := context.Background()
	result := make(map[string]ProfileCache)

	rows, err := db.pool.Query(ctx, `
		SELECT steam_id, name, avatar FROM profile_cache
		WHERE steam_id = ANY($1) AND fetched_at > NOW() - INTERVAL '24 hours'
	`, steamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var pc ProfileCache
		if err := rows.Scan(&pc.SteamID, &pc.Name, &pc.Avatar); err == nil {
			result[pc.SteamID] = pc
		}
	}
	return result, nil
}

func (db *DB) UpsertProfileCache(steamID, name, avatar string) {
	if db.pool == nil {
		return
	}
	ctx := context.Background()
	_, _ = db.pool.Exec(ctx, `
		INSERT INTO profile_cache (steam_id, name, avatar, fetched_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (steam_id) DO UPDATE SET name = EXCLUDED.name, avatar = EXCLUDED.avatar, fetched_at = NOW()
	`, steamID, name, avatar)
}

type ProfileCache struct {
	SteamID string
	Name    string
	Avatar  string
}

func (db *DB) UpsertWhitelist(steamID, name, addedBy string) error {
	if db.pool == nil {
		return fmt.Errorf("no database")
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO whitelist (steam_id, name, added_by, added_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (steam_id) DO UPDATE SET name = EXCLUDED.name, added_by = EXCLUDED.added_by, added_at = NOW()
	`, steamID, name, addedBy)
	return err
}

func (db *DB) DeleteWhitelist(steamID string) error {
	if db.pool == nil {
		return fmt.Errorf("no database")
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `DELETE FROM whitelist WHERE steam_id = $1`, steamID)
	return err
}

func (db *DB) GetWhitelist() ([]WhitelistEntryDB, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steam_id, name, added_by, added_at::text FROM whitelist ORDER BY added_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []WhitelistEntryDB
	for rows.Next() {
		var e WhitelistEntryDB
		if err := rows.Scan(&e.SteamID, &e.Name, &e.AddedBy, &e.Date); err == nil {
			entries = append(entries, e)
		}
	}
	return entries, nil
}

type WhitelistEntryDB struct {
	SteamID string
	Name    string
	AddedBy string
	Date    string
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func (db *DB) searchSteamIDsJSON(query string) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	path := db.staffFile
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil
	}

	var data map[string]staffDBEntry
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, nil
	}

	var ids []string
	q := query
	for sid, entry := range data {
		if entry.Name == q || entry.DiscordID == q || entry.DiscordName == q || sid == q {
			ids = append(ids, sid)
		}
	}
	return ids, nil
}

type staffDBEntry struct {
	Name        string `json:"name"`
	DiscordID   string `json:"discord_id"`
	DiscordName string `json:"discord_name"`
	Role        string `json:"role"`
	GroupName   string `json:"group_name"`
	UpdatedAt   string `json:"updated_at"`
}

func (db *DB) upsertUserJSON(user *models.User) error {
	db.mu.Lock()
	defer db.mu.Unlock()

	path := db.staffFile
	data := make(map[string]staffDBEntry)

	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &data)
	}

	key := user.SteamID
	if key == "" {
		key = user.DiscordID
	}

	data[key] = staffDBEntry{
		Name:        user.DisplayName,
		DiscordID:   user.DiscordID,
		DiscordName: user.Username,
		Role:        user.StaffRole,
		GroupName:   user.StaffGroup,
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	raw, _ := json.MarshalIndent(data, "", "  ")
	return os.WriteFile(path, raw, 0644)
}

func (db *DB) getUserByDiscordIDJSON(discordID string) (*models.User, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	path := db.staffFile
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("staff file not found")
	}

	var data map[string]staffDBEntry
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}

	for _, entry := range data {
		if entry.DiscordID == discordID {
			return &models.User{
				DiscordID:   entry.DiscordID,
				Username:    entry.DiscordName,
				DisplayName: entry.Name,
				StaffGroup:  entry.GroupName,
				StaffRole:   entry.Role,
			}, nil
		}
	}
	return nil, fmt.Errorf("user not found")
}

func (db *DB) GetStaffFromFile() (map[string]models.StaffMember, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	path := db.staffFile
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]models.StaffMember{}, nil
		}
		return nil, err
	}

	var data map[string]staffDBEntry
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}

	result := make(map[string]models.StaffMember)
	for k, v := range data {
		result[k] = models.StaffMember{
			SteamID:     k,
			Name:        v.Name,
			DiscordID:   v.DiscordID,
			DiscordName: v.DiscordName,
			Role:        v.Role,
			GroupName:   v.GroupName,
			UpdatedAt:   v.UpdatedAt,
		}
	}
	return result, nil
}

func getcwd() string {
	dir, _ := filepath.Abs(".")
	return dir
}

func (db *DB) SaveVDFCheck(checkID int, filename, attachmentURL, messageURL string, results []byte, steamids []string, bannedCount int) error {
	if db.pool == nil {
		return db.saveVDFCheckKV(checkID, filename, attachmentURL, messageURL, results, steamids, bannedCount)
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO vdf_checks (check_id, filename, timestamp, attachment_url, message_url, results, steamids, banned_count)
		VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
		ON CONFLICT (check_id) DO UPDATE SET
			filename = EXCLUDED.filename,
			attachment_url = EXCLUDED.attachment_url,
			message_url = EXCLUDED.message_url,
			results = EXCLUDED.results,
			steamids = EXCLUDED.steamids,
			banned_count = EXCLUDED.banned_count,
			last_recheck = NOW()
	`, checkID, filename, attachmentURL, messageURL, results, steamids, bannedCount)
	return err
}

func (db *DB) GetVDFChecks() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT check_id, filename, timestamp, attachment_url, message_url, results, steamids, banned_count, COALESCE(last_recheck::text, '')
		FROM vdf_checks ORDER BY check_id DESC LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var checks []map[string]interface{}
	for rows.Next() {
		var checkID int
		var filename, attachmentURL, messageURL, lastRecheck string
		var timestamp interface{}
		var results []byte
		var steamids []string
		var bannedCount int
		if err := rows.Scan(&checkID, &filename, &timestamp, &attachmentURL, &messageURL, &results, &steamids, &bannedCount, &lastRecheck); err != nil {
			continue
		}
		checks = append(checks, map[string]interface{}{
			"check_id":       checkID,
			"filename":       filename,
			"timestamp":      fmt.Sprintf("%v", timestamp),
			"attachment_url": attachmentURL,
			"message_url":    messageURL,
			"results":        json.RawMessage(results),
			"steamids":       steamids,
			"banned_count":   bannedCount,
			"last_recheck":   lastRecheck,
		})
	}
	return checks, nil
}

func (db *DB) saveVDFCheckKV(checkID int, filename, attachmentURL, messageURL string, results []byte, steamids []string, bannedCount int) error {
	data, err := db.GetKVStore("vdf_checks.json")
	if err != nil {
		data = []byte(`{"checks":{}}`)
	}
	var store map[string]interface{}
	if err := json.Unmarshal(data, &store); err != nil {
		store = map[string]interface{}{"checks": map[string]interface{}{}}
	}
	checks, _ := store["checks"].(map[string]interface{})
	checkKey := fmt.Sprintf("%d", checkID)
	checks[checkKey] = map[string]interface{}{
		"filename":       filename,
		"timestamp":      time.Now().UTC().Format(time.RFC3339),
		"attachment_url": attachmentURL,
		"message_url":    messageURL,
		"results":        json.RawMessage(results),
		"steamids":       steamids,
		"banned_count":   bannedCount,
	}
	store["checks"] = checks
	raw, _ := json.Marshal(store)
	return db.SetKVStore("vdf_checks.json", raw)
}

func (db *DB) LogService(service, level, message string, data interface{}) {
	if db.pool == nil {
		return
	}
	ctx := context.Background()
	var dataJSON []byte
	if data != nil {
		dataJSON, _ = json.Marshal(data)
	}
	_, _ = db.pool.Exec(ctx, `
		INSERT INTO app_logs (service, level, message, data, created_at)
		VALUES ($1, $2, $3, $4, NOW())
	`, service, level, message, dataJSON)
}

func (db *DB) GetNextCheckID() (int, error) {
	if db.pool == nil {
		return 1, nil
	}
	ctx := context.Background()
	var maxID int
	err := db.pool.QueryRow(ctx, `SELECT COALESCE(MAX(check_id), 0) FROM vdf_checks`).Scan(&maxID)
	if err != nil {
		return 1, nil
	}
	return maxID + 1, nil
}
