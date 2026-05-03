-- Таблицы веб-панели VibeCoding (префикс panel_).
-- Применять к той же PostgreSQL, что и init.sql (admins / profiles).
-- Можно выполнить после init.sql: psql "$DATABASE_URL" -f db/panel.sql

CREATE TABLE IF NOT EXISTS panel_action_logs (
    id SERIAL PRIMARY KEY,
    user_discord_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_steam_id TEXT,
    target_name TEXT,
    details TEXT,
    timestamp BIGINT NOT NULL,
    ip_address TEXT
);

CREATE TABLE IF NOT EXISTS panel_whitelist (
    id SERIAL PRIMARY KEY,
    steam_id TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    added_by_discord_id TEXT NOT NULL,
    added_by_name TEXT NOT NULL,
    reason TEXT,
    added_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_ban_comments (
    id SERIAL PRIMARY KEY,
    steam_id TEXT NOT NULL,
    ban_source TEXT NOT NULL,
    author_discord_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_server_activity (
    id SERIAL PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    hour INTEGER NOT NULL,
    total_players INTEGER NOT NULL,
    total_admins INTEGER NOT NULL,
    server_data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_user_levels (
    discord_id TEXT PRIMARY KEY,
    level INTEGER NOT NULL DEFAULT 1,
    added_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_invitation_codes (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    used_at BIGINT,
    created_by INTEGER,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    level INTEGER NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    last_activity BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    steam_id TEXT,
    launcher_api_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS panel_staff_tickets (
    steam_id TEXT NOT NULL,
    ym TEXT NOT NULL,
    tickets INTEGER NOT NULL DEFAULT 0,
    updated_by_user_id INTEGER,
    updated_by_username TEXT,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (steam_id, ym)
);

CREATE TABLE IF NOT EXISTS panel_staff_roles (
    steam_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    updated_by_user_id INTEGER,
    updated_by_username TEXT,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_panel_action_logs_user ON panel_action_logs(user_discord_id);
CREATE INDEX IF NOT EXISTS idx_panel_action_logs_ts ON panel_action_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_panel_whitelist_sid ON panel_whitelist(steam_id);
CREATE INDEX IF NOT EXISTS idx_panel_ban_comments_sid ON panel_ban_comments(steam_id);
CREATE INDEX IF NOT EXISTS idx_panel_server_activity_ts ON panel_server_activity(timestamp);
CREATE INDEX IF NOT EXISTS idx_panel_server_activity_hour ON panel_server_activity(hour);
CREATE UNIQUE INDEX IF NOT EXISTS idx_panel_users_username ON panel_users(username);
CREATE INDEX IF NOT EXISTS idx_panel_staff_tickets_ym ON panel_staff_tickets(ym);
CREATE INDEX IF NOT EXISTS idx_panel_staff_tickets_sid ON panel_staff_tickets(steam_id);
