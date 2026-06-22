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

	"github.com/jackc/pgx/v5"
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
		`CREATE TABLE IF NOT EXISTS config_hashes (
			id SERIAL PRIMARY KEY,
			config_hash VARCHAR(64) UNIQUE NOT NULL,
			filename TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS config_accounts (
			id SERIAL PRIMARY KEY,
			config_hash VARCHAR(64) NOT NULL REFERENCES config_hashes(config_hash) ON DELETE CASCADE,
			steamid VARCHAR(32) NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(config_hash, steamid)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_config_accounts_steamid ON config_accounts(steamid)`,
		`CREATE TABLE IF NOT EXISTS vdf_history (
			id SERIAL PRIMARY KEY,
			check_id INTEGER,
			steamid VARCHAR(32) NOT NULL,
			nickname TEXT,
			fear_banned BOOLEAN DEFAULT FALSE,
			fear_reason TEXT,
			fear_unban_time TEXT,
			vac_banned BOOLEAN DEFAULT FALSE,
			vac_days_ago INTEGER DEFAULT 0,
			game_bans INTEGER DEFAULT 0,
			yooma_banned BOOLEAN DEFAULT FALSE,
			yooma_reason TEXT,
			admin_group TEXT,
			config_hash VARCHAR(64),
			filename TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_vdf_history_steamid ON vdf_history(steamid)`,
		`CREATE INDEX IF NOT EXISTS idx_vdf_history_check_id ON vdf_history(check_id)`,
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

// ── Logs ────────────────────────────────────────────────────────────────────

func (db *DB) GetLogs(service, level, search string, limit, offset int) ([]map[string]interface{}, int, error) {
	if db.pool == nil {
		return nil, 0, fmt.Errorf("no database")
	}
	ctx := context.Background()

	where := "1=1"
	args := []interface{}{}
	argIdx := 1

	if service != "" {
		where += fmt.Sprintf(" AND service = $%d", argIdx)
		args = append(args, service)
		argIdx++
	}
	if level != "" {
		where += fmt.Sprintf(" AND level = $%d", argIdx)
		args = append(args, level)
		argIdx++
	}
	if search != "" {
		where += fmt.Sprintf(" AND message ILIKE $%d", argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*)::int FROM app_logs WHERE %s", where)
	err := db.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, service, level, message, data, created_at::text
		FROM app_logs WHERE %s
		ORDER BY id DESC LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var id int
		var svc, lvl, msg, createdAt string
		var data []byte
		if err := rows.Scan(&id, &svc, &lvl, &msg, &data, &createdAt); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"id":         id,
			"service":    svc,
			"level":      lvl,
			"message":    msg,
			"created_at": createdAt,
		}
		if len(data) > 0 {
			entry["data"] = json.RawMessage(data)
		}
		result = append(result, entry)
	}
	return result, total, nil
}

func (db *DB) GetLogsStats() (map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()

	var totalCount, todayCount, errorCount int
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM app_logs`).Scan(&totalCount)
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM app_logs WHERE created_at > NOW() - INTERVAL '1 day'`).Scan(&todayCount)
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM app_logs WHERE level = 'error' AND created_at > NOW() - INTERVAL '7 days'`).Scan(&errorCount)

	services := make(map[string]int)
	rows, err := db.pool.Query(ctx, `SELECT service, COUNT(*)::int as cnt FROM app_logs GROUP BY service ORDER BY cnt DESC`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var svc string
			var cnt int
			if err := rows.Scan(&svc, &cnt); err == nil {
				services[svc] = cnt
			}
		}
	}

	return map[string]interface{}{
		"total":     totalCount,
		"today":     todayCount,
		"errors_7d": errorCount,
		"services":  services,
	}, nil
}

func (db *DB) GetLoginHistory(limit, offset int) ([]map[string]interface{}, int, error) {
	if db.pool == nil {
		return nil, 0, fmt.Errorf("no database")
	}
	ctx := context.Background()

	var total int
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM login_history`).Scan(&total)

	rows, err := db.pool.Query(ctx, `
		SELECT lh.discord_id, lh.ip_address, lh.user_agent, lh.logged_in_at::text,
		       COALESCE(u.username, '') as username,
		       COALESCE(u.display_name, '') as display_name,
		       COALESCE(u.avatar, '') as avatar
		FROM login_history lh
		LEFT JOIN users u ON u.discord_id = lh.discord_id
		ORDER BY lh.id DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var discordID, ip, userAgent, loggedAt, username, displayName, avatar string
		if err := rows.Scan(&discordID, &ip, &userAgent, &loggedAt, &username, &displayName, &avatar); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"discord_id":   discordID,
			"ip_address":   ip,
			"user_agent":   userAgent,
			"logged_in_at": loggedAt,
			"username":     username,
			"display_name": displayName,
			"avatar":       avatar,
		})
	}
	return result, total, nil
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

func (db *DB) SaveConfigAccounts(configHash string, steamIDs []string, filename string) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO config_hashes (config_hash, filename, created_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (config_hash) DO UPDATE SET filename = EXCLUDED.filename
	`, configHash, filename)
	if err != nil {
		return err
	}
	for _, sid := range steamIDs {
		_, _ = db.pool.Exec(ctx, `
			INSERT INTO config_accounts (config_hash, steamid, created_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (config_hash, steamid) DO NOTHING
		`, configHash, sid)
	}
	return nil
}

func (db *DB) GetLinkedSteamIDs(steamID string) ([]string, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT DISTINCT ca2.steamid
		FROM config_accounts ca1
		JOIN config_accounts ca2 ON ca1.config_hash = ca2.config_hash
		WHERE ca1.steamid = $1
		ORDER BY ca2.steamid
	`, steamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err == nil {
			ids = append(ids, sid)
		}
	}
	return ids, nil
}

func (db *DB) SaveVDFHistoryEntry(checkID int, steamID, nickname string, fearBanned bool, fearReason, fearUnbanTime string, vacBanned bool, vacDaysAgo, gameBans int, yoomaBanned bool, yoomaReason, adminGroup, configHash, filename string) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO vdf_history
			(check_id, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
			 vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
			 admin_group, config_hash, filename, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
	`, checkID, steamID, nickname, fearBanned, fearReason, fearUnbanTime,
		vacBanned, vacDaysAgo, gameBans, yoomaBanned, yoomaReason,
		adminGroup, configHash, filename)
	return err
}

func (db *DB) GetVDFHistoryDetailed(limit int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
		       vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
		       admin_group, config_hash, filename, check_id, created_at::text
		FROM vdf_history
		ORDER BY id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var (
			steamID, nickname, fearReason, fearUnbanTime, yoomaReason string
			adminGroup, configHash, filename, createdAt              string
			fearBanned, vacBanned, yoomaBanned                       bool
			vacDaysAgo, gameBans, checkID                            int
		)
		if err := rows.Scan(&steamID, &nickname, &fearBanned, &fearReason, &fearUnbanTime,
			&vacBanned, &vacDaysAgo, &gameBans, &yoomaBanned, &yoomaReason,
			&adminGroup, &configHash, &filename, &checkID, &createdAt); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"steamid":        steamID,
			"nickname":       nickname,
			"fear_banned":    fearBanned,
			"fear_reason":    fearReason,
			"fear_unban_time": fearUnbanTime,
			"vac_banned":     vacBanned,
			"vac_days_ago":   vacDaysAgo,
			"game_bans":      gameBans,
			"yooma_banned":   yoomaBanned,
			"yooma_reason":   yoomaReason,
			"admin_group":    adminGroup,
			"config_hash":    configHash,
			"filename":       filename,
			"check_id":       checkID,
			"created_at":     createdAt,
		})
	}
	return result, nil
}

func (db *DB) GetVDFHistoryBySteamID(steamID string, limit int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
		       vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
		       admin_group, config_hash, filename, check_id, created_at::text
		FROM vdf_history
		WHERE steamid = $1
		ORDER BY id DESC
		LIMIT $2
	`, steamID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var (
			sid, nickname, fearReason, fearUnbanTime, yoomaReason string
			adminGroup, configHash, filename, createdAt          string
			fearBanned, vacBanned, yoomaBanned                   bool
			vacDaysAgo, gameBans, checkID                        int
		)
		if err := rows.Scan(&sid, &nickname, &fearBanned, &fearReason, &fearUnbanTime,
			&vacBanned, &vacDaysAgo, &gameBans, &yoomaBanned, &yoomaReason,
			&adminGroup, &configHash, &filename, &checkID, &createdAt); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"steamid":        sid,
			"nickname":       nickname,
			"fear_banned":    fearBanned,
			"fear_reason":    fearReason,
			"fear_unban_time": fearUnbanTime,
			"vac_banned":     vacBanned,
			"vac_days_ago":   vacDaysAgo,
			"game_bans":      gameBans,
			"yooma_banned":   yoomaBanned,
			"yooma_reason":   yoomaReason,
			"admin_group":    adminGroup,
			"config_hash":    configHash,
			"filename":       filename,
			"check_id":       checkID,
			"created_at":     createdAt,
		})
	}
	return result, nil
}

// ── VDF Rechecks ────────────────────────────────────────────────────────────

func (db *DB) CreateVDFRecheck(checkID int, steamIDs []string) (int, error) {
	if db.pool == nil {
		return 0, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var id int
	err := db.pool.QueryRow(ctx, `
		INSERT INTO vdf_rechecks (check_id, steamids, status)
		VALUES ($1, $2, 'pending') RETURNING id
	`, checkID, steamIDs).Scan(&id)
	return id, err
}

func (db *DB) GetPendingVDFRechecks() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT id, check_id, steamids, status, requested_at::text
		FROM vdf_rechecks WHERE status = 'pending'
		ORDER BY requested_at ASC LIMIT 10
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var id, checkID int
		var steamIDs []string
		var status, requestedAt string
		if err := rows.Scan(&id, &checkID, &steamIDs, &status, &requestedAt); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":            id,
			"check_id":      checkID,
			"steamids":      steamIDs,
			"status":        status,
			"requested_at":  requestedAt,
		})
	}
	return result, nil
}

func (db *DB) GetVDFRecheckResult(recheckID int) (map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var (
		id, checkID                    int
		steamIDs                       []string
		status                         string
		results                        []byte
		errorMsg                       *string
		requestedAt, startedAt, completedAt string
	)
	err := db.pool.QueryRow(ctx, `
		SELECT id, check_id, steamids, status, results, error,
		       COALESCE(requested_at::text, ''), COALESCE(started_at::text, ''), COALESCE(completed_at::text, '')
		FROM vdf_rechecks WHERE id = $1
	`, recheckID).Scan(&id, &checkID, &steamIDs, &status, &results, &errorMsg, &requestedAt, &startedAt, &completedAt)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{
		"id":            id,
		"check_id":      checkID,
		"steamids":      steamIDs,
		"status":        status,
		"results":       json.RawMessage(results),
		"requested_at":  requestedAt,
		"started_at":    startedAt,
		"completed_at":  completedAt,
	}
	if errorMsg != nil {
		result["error"] = *errorMsg
	}
	return result, nil
}

func (db *DB) GetConfigAccounts(configHash string) ([]string, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steamid FROM config_accounts WHERE config_hash = $1 ORDER BY steamid
	`, configHash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err == nil {
			ids = append(ids, sid)
		}
	}
	return ids, nil
}

func (db *DB) UpdateVDFHistoryBan(steamID string, fearBanned bool, fearReason, fearUnbanTime string) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		UPDATE vdf_history
		SET fear_banned = $2, fear_reason = $3, fear_unban_time = $4
		WHERE steamid = $1
	`, steamID, fearBanned, fearReason, fearUnbanTime)
	return err
}

// ── Shared tables: admins, profiles, punishments (written by bot) ───────────

func (db *DB) GetPunishmentsByAdmin(adminSteamID string, ptype int, limit, offset int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var rows pgx.Rows
	var err error
	if ptype > 0 {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments WHERE admin_steamid = $1 AND type = $2
			ORDER BY created DESC LIMIT $3 OFFSET $4
		`, adminSteamID, ptype, limit, offset)
	} else {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments WHERE admin_steamid = $1
			ORDER BY created DESC LIMIT $2 OFFSET $3
		`, adminSteamID, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPunishmentRows(rows)
}

func (db *DB) GetStaffPunishmentStats(since int64) (map[string]map[string]int, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT admin_steamid, type, COUNT(*)::int as count
		FROM punishments WHERE created >= $1 AND admin_steamid != ''
		GROUP BY admin_steamid, type
	`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := make(map[string]map[string]int)
	for rows.Next() {
		var adminSteam string
		var ptype, count int
		if err := rows.Scan(&adminSteam, &ptype, &count); err != nil {
			continue
		}
		if stats[adminSteam] == nil {
			stats[adminSteam] = make(map[string]int)
		}
		switch ptype {
		case 1:
			stats[adminSteam]["bans"] = count
		case 2:
			stats[adminSteam]["mutes"] = count
		}
		stats[adminSteam]["total"] += count
	}
	return stats, nil
}

func (db *DB) GetPunishmentsTrend(days int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT
			to_timestamp(created)::date as day,
			COUNT(*) FILTER (WHERE type = 1) as bans,
			COUNT(*) FILTER (WHERE type = 2) as mutes,
			COUNT(*) as total
		FROM punishments
		WHERE created >= EXTRACT(EPOCH FROM NOW() - ($1 || ' days')::INTERVAL)
		GROUP BY day ORDER BY day ASC
	`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var day interface{}
		var bans, mutes, total int
		if err := rows.Scan(&day, &bans, &mutes, &total); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"day":   fmt.Sprintf("%v", day),
			"bans":  bans,
			"mutes": mutes,
			"total": total,
		})
	}
	return result, nil
}

func (db *DB) GetPunishmentsMonthCompare() (map[string]map[string]int, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	result := map[string]map[string]int{
		"current":  {"bans": 0, "mutes": 0, "total": 0},
		"previous": {"bans": 0, "mutes": 0, "total": 0},
	}
	var currBans, currMutes, currTotal int
	err := db.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE type = 1),
			COUNT(*) FILTER (WHERE type = 2),
			COUNT(*)
		FROM punishments
		WHERE to_char(to_timestamp(created), 'YYYY-MM') = to_char(NOW(), 'YYYY-MM')
	`).Scan(&currBans, &currMutes, &currTotal)
	if err == nil {
		result["current"] = map[string]int{"bans": currBans, "mutes": currMutes, "total": currTotal}
	}
	var prevBans, prevMutes, prevTotal int
	err = db.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE type = 1),
			COUNT(*) FILTER (WHERE type = 2),
			COUNT(*)
		FROM punishments
		WHERE to_char(to_timestamp(created), 'YYYY-MM') = to_char(NOW() - INTERVAL '1 month', 'YYYY-MM')
	`).Scan(&prevBans, &prevMutes, &prevTotal)
	if err == nil {
		result["previous"] = map[string]int{"bans": prevBans, "mutes": prevMutes, "total": prevTotal}
	}
	return result, nil
}

func (db *DB) GetAdminsWithProfiles() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT a.admin_id, a.steamid, a.group_display_name, a.group_name,
		       a.immunity, a.is_frozen, a.avatar_full,
		       COALESCE(p.name, a.raw_json->>'name') AS name,
		       COALESCE(p.avatar_full, a.avatar_full) AS avatar,
		       p.rank, p.kills, p.deaths, p.playtime,
		       p.discord_nickname, p.discord_id,
		       p.ban_is_banned, p.vip_is_vip,
		       GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) AS updated_at
		FROM admins a LEFT JOIN profiles p ON p.steamid = a.steamid
		ORDER BY a.admin_id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var (
			adminID                                     int
			steamid, groupDisplayName, groupName        string
			immunity                                    int
			isFrozen                                    bool
			avatarFull, name, avatar                    string
			rank                                        *int
			kills, deaths, playtime                     *int
			discordNickname, discordID                  *string
			banIsBanned, vipIsVip                       *bool
			updatedAt                                   interface{}
		)
		if err := rows.Scan(&adminID, &steamid, &groupDisplayName, &groupName,
			&immunity, &isFrozen, &avatarFull,
			&name, &avatar, &rank, &kills, &deaths, &playtime,
			&discordNickname, &discordID, &banIsBanned, &vipIsVip, &updatedAt); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"admin_id":          adminID,
			"steamid":           steamid,
			"group_display_name": groupDisplayName,
			"group_name":        groupName,
			"immunity":          immunity,
			"is_frozen":         isFrozen,
			"avatar_full":       avatarFull,
			"name":              name,
			"avatar":            avatar,
			"updated_at":        fmt.Sprintf("%v", updatedAt),
		}
		if rank != nil {
			entry["rank"] = *rank
		}
		if kills != nil {
			entry["kills"] = *kills
		}
		if deaths != nil {
			entry["deaths"] = *deaths
		}
		if playtime != nil {
			entry["playtime"] = *playtime
		}
		if discordNickname != nil {
			entry["discord_nickname"] = *discordNickname
		}
		if discordID != nil {
			entry["discord_id"] = *discordID
		}
		if banIsBanned != nil {
			entry["ban_is_banned"] = *banIsBanned
		}
		if vipIsVip != nil {
			entry["vip_is_vip"] = *vipIsVip
		}
		result = append(result, entry)
	}
	return result, nil
}

func (db *DB) GetPunishmentsList(ptype int, limit, offset int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var rows pgx.Rows
	var err error
	if ptype > 0 {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments WHERE type = $1
			ORDER BY created DESC LIMIT $2 OFFSET $3
		`, ptype, limit, offset)
	} else {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments
			ORDER BY created DESC LIMIT $1 OFFSET $2
		`, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPunishmentRows(rows)
}

func scanPunishmentRows(rows pgx.Rows) ([]map[string]interface{}, error) {
	var result []map[string]interface{}
	for rows.Next() {
		var (
			id, duration, created, expires            int64
			ptype, status                             int
			steamid, name, admin, adminSteam, reason string
			updatedAt                                 interface{}
		)
		if err := rows.Scan(&id, &ptype, &steamid, &name, &admin, &adminSteam,
			&reason, &status, &duration, &created, &expires, &updatedAt); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":              id,
			"type":            ptype,
			"steamid":         steamid,
			"name":            name,
			"admin":           admin,
			"admin_steamid":   adminSteam,
			"reason":          reason,
			"status":          status,
			"duration":        duration,
			"created":         created,
			"expires":         expires,
			"updated_at":      fmt.Sprintf("%v", updatedAt),
		})
	}
	return result, nil
}

// ── Server Activity ─────────────────────────────────────────────────────────

func (db *DB) GetServerActivity(hours int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT timestamp, hour, total_players, total_admins, server_data
		FROM panel_server_activity
		WHERE timestamp > EXTRACT(EPOCH FROM NOW() - ($1 || ' hours')::INTERVAL)
		ORDER BY timestamp ASC
	`, hours)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var ts, hour, totalPlayers, totalAdmins int
		var serverData string
		if err := rows.Scan(&ts, &hour, &totalPlayers, &totalAdmins, &serverData); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"timestamp":     ts,
			"hour":          hour,
			"total_players": totalPlayers,
			"total_admins":  totalAdmins,
			"server_data":   serverData,
		})
	}
	return result, nil
}

func (db *DB) GetServerActivitySummary() (map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()

	var maxPlayers, avgPlayers, totalSnapshots int
	_ = db.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(total_players), 0), COALESCE(AVG(total_players)::int, 0), COUNT(*)::int
		FROM panel_server_activity WHERE timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
	`).Scan(&maxPlayers, &avgPlayers, &totalSnapshots)

	var lastPlayers int
	_ = db.pool.QueryRow(ctx, `
		SELECT total_players FROM panel_server_activity ORDER BY id DESC LIMIT 1
	`).Scan(&lastPlayers)

	hourly := make(map[string]int)
	rows, err := db.pool.Query(ctx, `
		SELECT hour, COALESCE(AVG(total_players)::int, 0) as avg_p
		FROM panel_server_activity
		WHERE timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
		GROUP BY hour ORDER BY hour
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var h, avg int
			if err := rows.Scan(&h, &avg); err == nil {
				hourly[fmt.Sprintf("%02d", h)] = avg
			}
		}
	}

	return map[string]interface{}{
		"max_24h":       maxPlayers,
		"avg_24h":       avgPlayers,
		"current":       lastPlayers,
		"snapshots_24h": totalSnapshots,
		"hourly":        hourly,
	}, nil
}
