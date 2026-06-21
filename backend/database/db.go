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
		return nil, nil
	}
	ctx := context.Background()
	q := "%" + query + "%"
	rows, err := db.pool.Query(ctx, `
		SELECT DISTINCT steam_id FROM users
		WHERE steam_id ILIKE $1 OR discord_id ILIKE $1 OR username ILIKE $1 OR display_name ILIKE $1
		AND steam_id IS NOT NULL AND steam_id != ''
	`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err == nil && sid != "" {
			ids = append(ids, sid)
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

// JSON fallback methods

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
