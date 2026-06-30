/**
 * Панельные данные (пользователи, сессии, whitelist, …) в PostgreSQL.
 * Таблицы с префиксом panel_ — не пересекаются с BDD (admins, profiles).
 * Подключение: только DATABASE_URL (общая с VibeCodingBdd).
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function getConnectionString() {
    return String(process.env.DATABASE_URL || '').trim();
}

let _pool;

function getPool() {
    const connectionString = getConnectionString();
    if (!connectionString) throw new Error('PostgreSQL: задайте DATABASE_URL');
    if (_pool) return _pool;
    const { Pool } = require('pg');
    const ssl =
        /sslmode=require|ssl=true|railway\.app|neon\.tech|supabase\.co|render\.com|amazonaws\.com/i.test(connectionString) ||
        String(process.env.PG_SSL || '').trim() === '1'
            ? { rejectUnauthorized: false }
            : undefined;
    _pool = new Pool({
        connectionString,
        max: Math.min(10, Number(process.env.PANEL_PG_POOL_MAX || 6) || 6),
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 15000,
        ssl
    });
    _pool.on('error', (err) => console.error('[panelPg] pool error:', err && err.message));
    return _pool;
}

function getBootstrapUsersFromEnv() {
    const users = [];
    const seen = new Set();
    const rawUsers = process.env.DEFAULT_USERS || '';
    if (rawUsers) {
        for (const entry of rawUsers.split(',')) {
            const parts = entry.trim().split(':');
            if (parts.length < 2) continue;
            const [usernameRaw, passwordRaw, levelStr] = parts;
            const username = String(usernameRaw || '').trim();
            const password = String(passwordRaw || '');
            if (!username || !password) continue;
            const level = Math.min(Math.max(parseInt(levelStr) || 1, 1), 5);
            if (!seen.has(username)) {
                users.push({ username, password, level, displayName: username });
                seen.add(username);
            }
        }
    }
    const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');
    if (adminUsername && adminPassword && !seen.has(adminUsername)) {
        const adminLevel = Math.min(Math.max(parseInt(process.env.ADMIN_LEVEL || '5') || 5, 1), 5);
        const adminDisplayName = String(process.env.ADMIN_DISPLAY_NAME || adminUsername).trim() || adminUsername;
        users.push({
            username: adminUsername,
            password: adminPassword,
            level: adminLevel,
            displayName: adminDisplayName
        });
        seen.add(adminUsername);
    }
    return users;
}

async function poolQuery(text, params) {
    return getPool().query(text, params);
}

async function initialize() {
    getPool();
}

async function initDatabase() {
    const pool = getPool();
    await pool.query(`
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
            ip_address TEXT,
            user_agent TEXT,
            country TEXT,
            city TEXT,
            device TEXT,
            os TEXT,
            browser TEXT,
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
            status TEXT NOT NULL DEFAULT 'pending',
            created_at BIGINT NOT NULL,
            last_login BIGINT DEFAULT 0,
            steam_id TEXT UNIQUE,
            launcher_api_key TEXT UNIQUE,
            discord_id TEXT UNIQUE,
            discord_name TEXT
        );
        -- Убедимся, что last_login существует и не мешает INSERT в старых схемах.
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'last_login'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN last_login BIGINT DEFAULT 0;
            END IF;
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'last_login' AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE panel_users ALTER COLUMN last_login DROP NOT NULL;
                ALTER TABLE panel_users ALTER COLUMN last_login SET DEFAULT 0;
            END IF;
        END
        $$;
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'password_hash'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN password_hash TEXT;
                UPDATE panel_users SET password_hash = '' WHERE password_hash IS NULL;
                ALTER TABLE panel_users ALTER COLUMN password_hash SET NOT NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'display_name'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN display_name TEXT;
                UPDATE panel_users SET display_name = username WHERE display_name IS NULL;
                ALTER TABLE panel_users ALTER COLUMN display_name SET NOT NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'created_at'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0;
                UPDATE panel_users SET created_at = EXTRACT(EPOCH FROM NOW()) * 1000 WHERE created_at = 0;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'level'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'status'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'steam_id'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN steam_id TEXT UNIQUE;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'launcher_api_key'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN launcher_api_key TEXT UNIQUE;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'discord_id'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN discord_id TEXT UNIQUE;
            END IF;
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'discord_id' AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE panel_users ALTER COLUMN discord_id DROP NOT NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'discord_name'
            ) THEN
                ALTER TABLE panel_users ADD COLUMN discord_name TEXT;
            END IF;
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'launcher_api_key' AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE panel_users ALTER COLUMN launcher_api_key DROP NOT NULL;
            END IF;
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_users' AND column_name = 'steam_id' AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE panel_users ALTER COLUMN steam_id DROP NOT NULL;
            END IF;
            -- Drop NOT NULL from any other column that might cause INSERT failures (e.g. last_login from old schema)
            DECLARE
                drop_not_null_sql TEXT;
            BEGIN
                SELECT COALESCE(
                    string_agg(
                        format('ALTER TABLE panel_users ALTER COLUMN %I DROP NOT NULL', column_name),
                        '; '
                    ),
                    ''
                )
                INTO drop_not_null_sql
                FROM information_schema.columns
                WHERE table_name = 'panel_users'
                  AND column_name NOT IN ('id', 'username')
                  AND is_nullable = 'NO';

                IF drop_not_null_sql <> '' THEN
                    EXECUTE drop_not_null_sql;
                END IF;
            END;
        END
        $$;
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'username'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN username TEXT;
                UPDATE panel_sessions SET username = '' WHERE username IS NULL;
                ALTER TABLE panel_sessions ALTER COLUMN username SET NOT NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'display_name'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN display_name TEXT;
                UPDATE panel_sessions SET display_name = username WHERE display_name IS NULL;
                ALTER TABLE panel_sessions ALTER COLUMN display_name SET NOT NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'level'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'ip_address'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN ip_address TEXT;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'user_agent'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN user_agent TEXT;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'country'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN country TEXT;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'city'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN city TEXT;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'device'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN device TEXT;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'os'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN os TEXT;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'browser'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN browser TEXT;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'expires_at'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN expires_at BIGINT NOT NULL DEFAULT 0;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'created_at'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'panel_sessions' AND column_name = 'last_activity'
            ) THEN
                ALTER TABLE panel_sessions ADD COLUMN last_activity BIGINT NOT NULL DEFAULT 0;
            END IF;
            -- Drop NOT NULL from any extra column that might cause INSERT failures
            DECLARE
                drop_not_null_sql TEXT;
            BEGIN
                SELECT COALESCE(
                    string_agg(
                        format('ALTER TABLE panel_sessions ALTER COLUMN %I DROP NOT NULL', column_name),
                        '; '
                    ),
                    ''
                )
                INTO drop_not_null_sql
                FROM information_schema.columns
                WHERE table_name = 'panel_sessions'
                  AND column_name NOT IN ('token', 'user_id')
                  AND is_nullable = 'NO';

                IF drop_not_null_sql <> '' THEN
                    EXECUTE drop_not_null_sql;
                END IF;
            END;
        END
        $$;
        CREATE TABLE IF NOT EXISTS panel_login_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            country TEXT,
            city TEXT,
            device TEXT,
            os TEXT,
            browser TEXT,
            action TEXT NOT NULL,
            details TEXT,
            created_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS panel_registration_confirmations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            discord_id TEXT NOT NULL,
            confirmation_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            level INTEGER,
            expires_at BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            confirmed_at BIGINT,
            rejected_at BIGINT
        );
        CREATE TABLE IF NOT EXISTS panel_bot_tasks (
            id SERIAL PRIMARY KEY,
            type TEXT NOT NULL,
            payload JSONB NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result JSONB,
            created_at BIGINT NOT NULL,
            processed_at BIGINT
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
        CREATE TABLE IF NOT EXISTS panel_staff_check_ranks (
            steam_id TEXT PRIMARY KEY,
            rank TEXT NOT NULL DEFAULT '',
            updated_by_user_id INTEGER,
            updated_by_username TEXT,
            updated_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS panel_fear_punishments (
            punishment_id INTEGER PRIMARY KEY,
            steamid TEXT NOT NULL,
            name TEXT,
            admin_steamid TEXT NOT NULL,
            admin_name TEXT,
            reason TEXT,
            status INTEGER,
            duration INTEGER,
            created INTEGER,
            expires INTEGER,
            type INTEGER,
            punish_type INTEGER,
            avatar TEXT,
            admin_avatar TEXT,
            updated_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS config_hashes (
            config_hash VARCHAR(64) PRIMARY KEY,
            filename TEXT,
            content TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS config_accounts (
            config_hash VARCHAR(64) NOT NULL REFERENCES config_hashes(config_hash) ON DELETE CASCADE,
            steamid VARCHAR(32) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(config_hash, steamid)
        );
        CREATE TABLE IF NOT EXISTS vdf_history (
            id SERIAL PRIMARY KEY,
            check_id INTEGER NOT NULL,
            source VARCHAR(16) DEFAULT 'site',
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
            attachment_url TEXT,
            message_url TEXT,
            on_fear BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'site';

        CREATE TABLE IF NOT EXISTS drops (
            id BIGSERIAL PRIMARY KEY,
            external_id BIGINT,
            name TEXT,
            image TEXT,
            price TEXT,
            rarity_color TEXT,
            avatar TEXT,
            player_name TEXT,
            steamid VARCHAR(32),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(external_id)
        );
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_panel_action_logs_user ON panel_action_logs(user_discord_id);
        CREATE INDEX IF NOT EXISTS idx_panel_action_logs_ts ON panel_action_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_panel_whitelist_sid ON panel_whitelist(steam_id);
        CREATE INDEX IF NOT EXISTS idx_panel_ban_comments_sid ON panel_ban_comments(steam_id);
        CREATE INDEX IF NOT EXISTS idx_panel_server_activity_ts ON panel_server_activity(timestamp);
        CREATE INDEX IF NOT EXISTS idx_panel_server_activity_hour ON panel_server_activity(hour);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_panel_users_username ON panel_users(username);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_panel_users_discord_id ON panel_users(discord_id);
        CREATE INDEX IF NOT EXISTS idx_panel_staff_tickets_ym ON panel_staff_tickets(ym);
        CREATE INDEX IF NOT EXISTS idx_panel_staff_tickets_sid ON panel_staff_tickets(steam_id);
        CREATE INDEX IF NOT EXISTS idx_panel_staff_check_ranks_sid ON panel_staff_check_ranks(steam_id);
        CREATE INDEX IF NOT EXISTS idx_panel_fear_pun_admin ON panel_fear_punishments(admin_steamid);
        CREATE INDEX IF NOT EXISTS idx_panel_fear_pun_created ON panel_fear_punishments(created);
        CREATE INDEX IF NOT EXISTS idx_panel_fear_pun_status ON panel_fear_punishments(status);
        CREATE INDEX IF NOT EXISTS idx_vdf_history_steamid ON vdf_history(steamid);
        CREATE INDEX IF NOT EXISTS idx_vdf_history_check_id ON vdf_history(check_id);
        CREATE INDEX IF NOT EXISTS idx_drops_created_at ON drops(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_drops_steamid ON drops(steamid);
    `);
    // Миграция: добавляем discord_id и launcher_api_key в старые таблицы panel_users
    try { await poolQuery('ALTER TABLE panel_users ADD COLUMN discord_id TEXT UNIQUE'); } catch (_) {}
    try { await poolQuery('ALTER TABLE panel_users ADD COLUMN launcher_api_key TEXT UNIQUE'); } catch (_) {}
    try { await poolQuery('ALTER TABLE config_hashes ADD COLUMN IF NOT EXISTS content TEXT'); } catch (_) {}

    const bootstrapUsers = getBootstrapUsersFromEnv();
    for (const u of bootstrapUsers) {
        const { rows } = await pool.query('SELECT id FROM panel_users WHERE username = $1', [u.username]);
        if (rows.length === 0) {
            const hash = bcrypt.hashSync(u.password, 10);
            await pool.query(
                'INSERT INTO panel_users (username, password_hash, display_name, level, created_at, last_login) VALUES ($1,$2,$3,$4,$5,0)',
                [u.username, hash, u.displayName || u.username, u.level, Date.now()]
            );
            console.log(`[Auth] Пользователь "${u.username}" создан (level=${u.level}) [PostgreSQL]`);
        }
    }
    await migrateAllUserLauncherKeys();
    console.log('✅ База данных панели инициализирована (PostgreSQL)');
}

function getDbPath() {
    const u = getConnectionString();
    if (!u) return '(postgresql: не настроено)';
    try {
        const parsed = new URL(u.replace(/^postgresql:\/\//i, 'http://'));
        return `(postgresql://${parsed.hostname || 'host'}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname || ''})`;
    } catch (_) {
        return '(postgresql)';
    }
}

async function closeDatabase() {
    if (_pool) {
        try {
            await _pool.end();
        } catch (_) {}
        _pool = null;
    }
}

function generateLauncherApiKey() {
    return 'lfp_' + crypto.randomBytes(32).toString('base64url');
}

async function ensureUserLauncherApiKey(userId) {
    const id = Number(userId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const { rows } = await poolQuery('SELECT launcher_api_key FROM panel_users WHERE id = $1', [id]);
    if (!rows[0]) return null;
    const existing = rows[0].launcher_api_key != null && String(rows[0].launcher_api_key).trim() !== '';
    if (existing) return String(rows[0].launcher_api_key).trim();
    for (let attempt = 0; attempt < 5; attempt++) {
        const key = generateLauncherApiKey();
        try {
            const r = await poolQuery('UPDATE panel_users SET launcher_api_key = $1 WHERE id = $2', [key, id]);
            if (r.rowCount > 0) return key;
        } catch (e) {
            if (!String(e.message || '').includes('unique')) {
                console.warn('[panelPg] ensureUserLauncherApiKey:', e.message);
                return null;
            }
        }
    }
    return null;
}

async function migrateAllUserLauncherKeys() {
    try {
        const { rows } = await poolQuery(
            'SELECT id FROM panel_users WHERE launcher_api_key IS NULL OR launcher_api_key = $1',
            ['']
        );
        for (const r of rows) {
            await ensureUserLauncherApiKey(r.id);
        }
    } catch (e) {
        console.warn('[panelPg] migrateAllUserLauncherKeys:', e.message);
    }
}

function normalizeYm(ym) {
    const v = String(ym || '').trim();
    if (!v) return '';
    return /^\d{4}-\d{2}$/.test(v) ? v : '';
}

function clampInt(n, min, max) {
    const x = parseInt(n, 10);
    if (!Number.isFinite(x)) return min;
    return Math.min(Math.max(x, min), max);
}

async function upsertStaffTickets(steamId, ym, tickets, updatedByUserId, updatedByUsername) {
    const sid = String(steamId || '').trim();
    const m = normalizeYm(ym);
    if (!sid || !m) return false;
    const t = clampInt(tickets, 0, 1000000);
    const now = Date.now();
    await poolQuery(
        `INSERT INTO panel_staff_tickets (steam_id, ym, tickets, updated_by_user_id, updated_by_username, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (steam_id, ym) DO UPDATE SET
           tickets = EXCLUDED.tickets,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_by_username = EXCLUDED.updated_by_username,
           updated_at = EXCLUDED.updated_at`,
        [sid, m, t, updatedByUserId != null ? Number(updatedByUserId) : null, String(updatedByUsername || ''), now]
    );
    return true;
}

async function getStaffTicketsByMonth(ym) {
    const m = normalizeYm(ym);
    if (!m) return [];
    const { rows } = await poolQuery(
        'SELECT steam_id, ym, tickets, updated_by_user_id, updated_by_username, updated_at FROM panel_staff_tickets WHERE ym = $1',
        [m]
    );
    return rows;
}

async function getStaffTicketsOne(steamId, ym) {
    const sid = String(steamId || '').trim();
    const m = normalizeYm(ym);
    if (!sid || !m) return null;
    const { rows } = await poolQuery(
        'SELECT steam_id, ym, tickets, updated_by_user_id, updated_by_username, updated_at FROM panel_staff_tickets WHERE steam_id = $1 AND ym = $2',
        [sid, m]
    );
    return rows[0] || null;
}

async function upsertStaffRole(steamId, role, updatedByUserId, updatedByUsername) {
    const sid = String(steamId || '').trim();
    const r = String(role || '').trim().toUpperCase();
    if (!sid || !r) return false;
    const now = Date.now();
    await poolQuery(
        `INSERT INTO panel_staff_roles (steam_id, role, updated_by_user_id, updated_by_username, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (steam_id) DO UPDATE SET
           role = EXCLUDED.role,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_by_username = EXCLUDED.updated_by_username,
           updated_at = EXCLUDED.updated_at`,
        [sid, r, updatedByUserId != null ? Number(updatedByUserId) : null, String(updatedByUsername || ''), now]
    );
    return true;
}

async function deleteStaffRole(steamId) {
    const sid = String(steamId || '').trim();
    if (!sid) return false;
    const r = await poolQuery('DELETE FROM panel_staff_roles WHERE steam_id = $1', [sid]);
    return r.rowCount > 0;
}

async function getAllStaffRoles() {
    const { rows } = await poolQuery(
        'SELECT steam_id, role, updated_by_user_id, updated_by_username, updated_at FROM panel_staff_roles',
        []
    );
    return rows;
}

async function upsertStaffCheckRank(steamId, rank, updatedByUserId, updatedByUsername) {
    const sid = String(steamId || '').trim();
    const r = String(rank || '').trim();
    if (!sid || !r) return false;
    const now = Date.now();
    await poolQuery(
        `INSERT INTO panel_staff_check_ranks (steam_id, rank, updated_by_user_id, updated_by_username, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (steam_id) DO UPDATE SET
           rank = EXCLUDED.rank,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_by_username = EXCLUDED.updated_by_username,
           updated_at = EXCLUDED.updated_at`,
        [sid, r, updatedByUserId != null ? Number(updatedByUserId) : null, String(updatedByUsername || ''), now]
    );
    return true;
}

async function deleteStaffCheckRank(steamId) {
    const sid = String(steamId || '').trim();
    if (!sid) return false;
    const r = await poolQuery('DELETE FROM panel_staff_check_ranks WHERE steam_id = $1', [sid]);
    return r.rowCount > 0;
}

async function getAllStaffCheckRanks() {
    const { rows } = await poolQuery(
        'SELECT steam_id, rank, updated_by_user_id, updated_by_username, updated_at FROM panel_staff_check_ranks',
        []
    );
    return rows;
}

async function logAction(userId, userName, actionType, targetSteamId, targetName, details, ipAddress) {
    await poolQuery(
        `INSERT INTO panel_action_logs (user_discord_id, user_name, action_type, target_steam_id, target_name, details, timestamp, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, userName, actionType, targetSteamId, targetName, details, Date.now(), ipAddress]
    );
}

async function getActionLogs(limit = 100, offset = 0) {
    const { rows } = await poolQuery(
        'SELECT * FROM panel_action_logs ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
        [limit, offset]
    );
    return rows;
}

async function getActionLogsByUser(userId, limit = 50) {
    const { rows } = await poolQuery(
        'SELECT * FROM panel_action_logs WHERE user_discord_id = $1 ORDER BY timestamp DESC LIMIT $2',
        [userId, limit]
    );
    return rows;
}

async function addToWhitelist(steamId, nickname, addedById, addedByName, reason) {
    await poolQuery(
        `INSERT INTO panel_whitelist (steam_id, nickname, added_by_discord_id, added_by_name, reason, added_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (steam_id) DO UPDATE SET
           nickname = EXCLUDED.nickname,
           added_by_discord_id = EXCLUDED.added_by_discord_id,
           added_by_name = EXCLUDED.added_by_name,
           reason = EXCLUDED.reason,
           added_at = EXCLUDED.added_at`,
        [steamId, nickname, addedById, addedByName, reason, Date.now()]
    );
}

async function removeFromWhitelist(steamId) {
    await poolQuery('DELETE FROM panel_whitelist WHERE steam_id = $1', [steamId]);
}

async function isWhitelisted(steamId) {
    const { rows } = await poolQuery('SELECT 1 FROM panel_whitelist WHERE steam_id = $1', [steamId]);
    return rows.length > 0;
}

async function getWhitelistEntry(steamId) {
    const { rows } = await poolQuery('SELECT added_by_discord_id FROM panel_whitelist WHERE steam_id = $1', [steamId]);
    return rows[0] || null;
}

async function getWhitelist() {
    const { rows } = await poolQuery('SELECT * FROM panel_whitelist ORDER BY added_at DESC', []);
    return rows;
}

async function addBanComment(steamId, banSource, authorId, authorName, comment) {
    await poolQuery(
        `INSERT INTO panel_ban_comments (steam_id, ban_source, author_discord_id, author_name, comment, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [steamId, banSource, authorId, authorName, comment, Date.now()]
    );
}

async function getBanComments(steamId) {
    const { rows } = await poolQuery(
        'SELECT * FROM panel_ban_comments WHERE steam_id = $1 ORDER BY created_at DESC',
        [steamId]
    );
    return rows;
}

async function deleteBanComment(commentId, authorId, userLevel) {
    const { rows } = await poolQuery('SELECT author_discord_id FROM panel_ban_comments WHERE id = $1', [commentId]);
    const comment = rows[0];
    if (!comment) return false;
    if (String(comment.author_discord_id) !== String(authorId) && !(userLevel && userLevel >= 4)) return false;
    const r = await poolQuery('DELETE FROM panel_ban_comments WHERE id = $1', [commentId]);
    return r.rowCount > 0;
}

async function saveServerActivity(totalPlayers, totalAdmins, serverData) {
    const now = Date.now();
    const hour = new Date(now).getHours();
    await poolQuery(
        'INSERT INTO panel_server_activity (timestamp, hour, total_players, total_admins, server_data) VALUES ($1,$2,$3,$4,$5)',
        [now, hour, totalPlayers, totalAdmins, JSON.stringify(serverData)]
    );
}

async function getServerActivityByHour(days = 7) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const { rows } = await poolQuery(
        `SELECT hour, AVG(total_players)::float AS avg_players, AVG(total_admins)::float AS avg_admins
         FROM panel_server_activity WHERE timestamp > $1 GROUP BY hour ORDER BY hour`,
        [since]
    );
    return rows;
}

async function getServerActivityHistory(hours = 24) {
    const now = Date.now();
    const since = now - hours * 60 * 60 * 1000;
    const bucketMs = 60 * 60 * 1000;
    const { rows } = await poolQuery(
        'SELECT timestamp, total_players FROM panel_server_activity WHERE timestamp > $1 ORDER BY timestamp ASC',
        [since]
    );
    const buckets = Array.from({ length: 24 }, (_, i) => ({ timestamp: since + i * bucketMs, total_players: 0 }));
    for (const row of rows) {
        const slot = Math.min(23, Math.floor((row.timestamp - since) / bucketMs));
        if (slot >= 0 && row.total_players > buckets[slot].total_players) buckets[slot].total_players = row.total_players;
    }
    return buckets;
}

async function getServerActivityRange(range = 'day') {
    const now = Date.now();
    if (range === 'day') {
        const hours = 24;
        const bucketMs = 60 * 60 * 1000;
        const since = now - hours * bucketMs;
        const { rows } = await poolQuery(
            'SELECT timestamp, total_players FROM panel_server_activity WHERE timestamp > $1 ORDER BY timestamp ASC',
            [since]
        );
        const buckets = Array.from({ length: hours }, (_, i) => ({
            timestamp: since + i * bucketMs,
            total_players: 0,
            _sum: 0,
            _count: 0
        }));
        for (const row of rows) {
            const slot = Math.min(hours - 1, Math.floor((row.timestamp - since) / bucketMs));
            if (slot < 0) continue;
            const v = Number(row.total_players) || 0;
            buckets[slot]._sum += v;
            buckets[slot]._count += 1;
        }
        return buckets.map((b) => ({
            timestamp: b.timestamp,
            total_players: b._count > 0 ? Math.round(b._sum / b._count) : 0
        }));
    }
    if (range === 'week') {
        const days = 7;
        const since = now - days * 24 * 60 * 60 * 1000;
        const bucketMs = 24 * 60 * 60 * 1000;
        const { rows } = await poolQuery(
            `SELECT timestamp, total_players FROM panel_server_activity WHERE timestamp > $1 ORDER BY timestamp ASC`,
            [since]
        );
        const buckets = Array.from({ length: days }, (_, i) => ({
            timestamp: since + i * bucketMs,
            total_players: 0,
            _sum: 0,
            _count: 0
        }));
        for (const row of rows) {
            const slot = Math.min(days - 1, Math.floor((row.timestamp - since) / bucketMs));
            if (slot < 0) continue;
            const v = Number(row.total_players) || 0;
            buckets[slot]._sum += v;
            buckets[slot]._count += 1;
        }
        return buckets.map((b) => ({
            timestamp: b.timestamp,
            total_players: b._count > 0 ? Math.round(b._sum / b._count) : 0
        }));
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const minRow = (await poolQuery('SELECT MIN(timestamp) AS min_ts FROM panel_server_activity', [])).rows[0];
    const minTsRaw = minRow?.min_ts ? Number(minRow.min_ts) : now;
    const since = Math.floor(minTsRaw / dayMs) * dayMs;
    const until = Math.floor(now / dayMs) * dayMs;
    const dayCount = Math.max(1, Math.floor((until - since) / dayMs) + 1);
    const { rows } = await poolQuery(
        `SELECT
            FLOOR((timestamp - $1)::numeric / $2::numeric)::int AS day_idx,
            AVG(total_players)::float AS total_players
         FROM panel_server_activity
         WHERE timestamp >= $1
         GROUP BY day_idx
         ORDER BY day_idx ASC`,
        [since, dayMs]
    );
    const buckets = Array.from({ length: dayCount }, (_, i) => ({ timestamp: since + i * dayMs, total_players: 0 }));
    for (const row of rows) {
        const idx = Number(row.day_idx);
        if (!Number.isFinite(idx) || idx < 0 || idx >= buckets.length) continue;
        buckets[idx].total_players = Number(row.total_players) || 0;
    }
    return buckets;
}

async function setUserLevel(id, level) {
    await poolQuery(
        `INSERT INTO panel_user_levels (discord_id, level, added_at) VALUES ($1,$2,$3)
         ON CONFLICT (discord_id) DO UPDATE SET level = EXCLUDED.level, added_at = EXCLUDED.added_at`,
        [id, level, Date.now()]
    );
}

async function getUserLevel(id) {
    const { rows } = await poolQuery('SELECT level FROM panel_user_levels WHERE discord_id = $1', [id]);
    return rows[0] ? rows[0].level : 0;
}

async function removeUserLevel(id) {
    await poolQuery('DELETE FROM panel_user_levels WHERE discord_id = $1', [id]);
}

async function getAllUserLevels() {
    const { rows } = await poolQuery('SELECT * FROM panel_user_levels ORDER BY level DESC, added_at DESC', []);
    return rows;
}

async function setSetting(key, value) {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    await poolQuery(
        `INSERT INTO panel_app_settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, v]
    );
}

async function getSetting(key, defaultValue = null) {
    const { rows } = await poolQuery('SELECT value FROM panel_app_settings WHERE key = $1', [key]);
    if (!rows[0]) return defaultValue;
    try {
        return JSON.parse(rows[0].value);
    } catch (_) {
        return rows[0].value;
    }
}

async function getAllSettings() {
    const { rows } = await poolQuery('SELECT key, value FROM panel_app_settings', []);
    const result = {};
    for (const row of rows) {
        try {
            result[row.key] = JSON.parse(row.value);
        } catch (_) {
            result[row.key] = row.value;
        }
    }
    return result;
}

async function createUser(username, password, displayName, level = 1, status = 'active', steamId = null) {
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await poolQuery(
        'INSERT INTO panel_users (username, password_hash, display_name, level, status, created_at, steam_id, last_login) VALUES ($1,$2,$3,$4,$5,$6,$7,0) RETURNING id',
        [username, hash, displayName || username, level, status, Date.now(), steamId]
    );
    const newId = rows[0].id;
    await ensureUserLauncherApiKey(newId);
    return newId;
}

async function createPendingUser(username, password, displayName, steamId) {
    return createUser(username, password, displayName, 0, 'pending', steamId);
}

async function getUserBySteamId(steamId) {
    const { rows } = await poolQuery(
        'SELECT id, username, display_name, level, status, created_at, steam_id, discord_id, discord_name FROM panel_users WHERE steam_id = $1',
        [steamId]
    );
    const user = rows[0];
    return user ? {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        level: user.level,
        status: user.status,
        createdAt: user.created_at,
        steamId: user.steam_id || null,
        discordId: user.discord_id || null,
        discordName: user.discord_name || null
    } : null;
}

async function updateUserStatusAndLevel(id, status, level) {
    await poolQuery(
        'UPDATE panel_users SET status = $1, level = $2 WHERE id = $3',
        [status, level, id]
    );
}

async function updateUserDiscordId(id, discordId) {
    await poolQuery(
        'UPDATE panel_users SET discord_id = $1 WHERE id = $2',
        [discordId, id]
    );
}

async function updateUserDiscordName(id, discordName) {
    await poolQuery(
        'UPDATE panel_users SET discord_name = $1 WHERE id = $2',
        [discordName, id]
    );
}

async function createOrUpdateDiscordUser(discordId, username, displayName, level) {
    const existing = await poolQuery('SELECT id FROM panel_users WHERE discord_id = $1', [discordId]);
    const safeUsername = username || 'discord_' + discordId;
    const safeDisplayName = displayName || safeUsername;
    const now = Date.now();
    if (existing.rows[0]) {
        await poolQuery(
            'UPDATE panel_users SET username = $1, display_name = $2, level = $3, discord_name = $4 WHERE id = $5',
            [safeUsername, safeDisplayName, level, safeDisplayName, existing.rows[0].id]
        );
        return existing.rows[0].id;
    }
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const hash = bcrypt.hashSync(tempPassword, 10);
    const { rows } = await poolQuery(
        'INSERT INTO panel_users (username, password_hash, display_name, level, created_at, steam_id, discord_id, discord_name, last_login) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0) RETURNING id',
        [safeUsername, hash, safeDisplayName, level, now, null, discordId, safeDisplayName]
    );
    const newId = rows[0].id;
    await ensureUserLauncherApiKey(newId);
    return newId;
}

async function verifyUser(username, password) {
    const { rows } = await poolQuery('SELECT * FROM panel_users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
    return {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        level: user.level,
        status: user.status,
        steamId: user.steam_id || null,
        discordId: user.discord_id || null,
        discordName: user.discord_name || null
    };
}

async function getUserById(id) {
    const { rows } = await poolQuery(
        'SELECT id, username, display_name, level, status, created_at, steam_id, discord_id, discord_name FROM panel_users WHERE id = $1',
        [id]
    );
    const user = rows[0];
    return user
        ? {
              id: user.id,
              username: user.username,
              displayName: user.display_name,
              level: user.level,
              status: user.status,
              createdAt: user.created_at,
              steamId: user.steam_id || null,
              discordId: user.discord_id || null,
              discordName: user.discord_name || null
          }
        : null;
}

async function getUserByDiscordId(discordId) {
    const { rows } = await poolQuery(
        'SELECT id, username, display_name, level, status, created_at, steam_id, discord_id, discord_name FROM panel_users WHERE discord_id = $1',
        [discordId]
    );
    const user = rows[0];
    return user
        ? {
              id: user.id,
              username: user.username,
              displayName: user.display_name,
              level: user.level,
              status: user.status,
              createdAt: user.created_at,
              steamId: user.steam_id || null,
              discordId: user.discord_id || null,
              discordName: user.discord_name || null
          }
        : null;
}

async function getAllUsers() {
    const { rows } = await poolQuery(
        'SELECT id, username, display_name, level, created_at, steam_id, discord_id, discord_name FROM panel_users ORDER BY level DESC, created_at ASC',
        []
    );
    return rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        level: u.level,
        createdAt: u.created_at,
        steamId: u.steam_id || null,
        discordId: u.discord_id || null,
        discordName: u.discord_name || null
    }));
}

async function deleteUser(id) {
    const r = await poolQuery('DELETE FROM panel_users WHERE id = $1', [id]);
    return r.rowCount > 0;
}

async function updateUserLevel(id, level) {
    const r = await poolQuery('UPDATE panel_users SET level = $1 WHERE id = $2', [level, id]);
    return r.rowCount > 0;
}

async function updateUserPassword(id, newPassword) {
    const hash = bcrypt.hashSync(newPassword, 10);
    const r = await poolQuery('UPDATE panel_users SET password_hash = $1 WHERE id = $2', [hash, id]);
    return r.rowCount > 0;
}

async function updateUserSteamId(id, steamId) {
    const r = await poolQuery('UPDATE panel_users SET steam_id = $1 WHERE id = $2', [steamId || null, id]);
    return r.rowCount > 0;
}

async function getUserCount() {
    const { rows } = await poolQuery('SELECT COUNT(*)::int AS cnt FROM panel_users', []);
    return rows[0].cnt;
}

async function deleteAllUsers() {
    await poolQuery('DELETE FROM panel_users', []);
}

async function restoreUsersFromEnv() {
    let restored = 0;
    const users = getBootstrapUsersFromEnv();
    if (!users.length) return restored;
    for (const u of users) {
        const { rows } = await poolQuery('SELECT id FROM panel_users WHERE username = $1', [u.username]);
        if (rows.length === 0) {
            const hash = bcrypt.hashSync(u.password, 10);
            await poolQuery(
                'INSERT INTO panel_users (username, password_hash, display_name, level, created_at, last_login) VALUES ($1,$2,$3,$4,$5,0)',
                [u.username, hash, u.displayName || u.username, u.level, Date.now()]
            );
            restored++;
            console.log(`[Auth] Восстановлен пользователь "${u.username}" (level=${u.level}) [PostgreSQL]`);
        }
    }
    return restored;
}

async function createInviteCode(level, createdBy) {
    const code = crypto.randomBytes(12).toString('base64url');
    await poolQuery('INSERT INTO panel_invitation_codes (code, level, created_by, created_at) VALUES ($1,$2,$3,$4)', [
        code,
        level,
        createdBy || null,
        Date.now()
    ]);
    return code;
}

async function validateInviteCode(code) {
    const { rows } = await poolQuery('SELECT level FROM panel_invitation_codes WHERE code = $1 AND used_at IS NULL', [code]);
    return rows[0] ? rows[0].level : null;
}

async function useInviteCode(code) {
    const { rows } = await poolQuery('SELECT * FROM panel_invitation_codes WHERE code = $1 AND used_at IS NULL', [code]);
    const row = rows[0];
    if (!row) return null;
    await poolQuery('UPDATE panel_invitation_codes SET used_at = $1 WHERE id = $2', [Date.now(), row.id]);
    return row.level;
}

async function getInviteCodes(includeUsed = false) {
    const q = includeUsed
        ? 'SELECT * FROM panel_invitation_codes ORDER BY created_at DESC'
        : 'SELECT * FROM panel_invitation_codes WHERE used_at IS NULL ORDER BY created_at DESC';
    const { rows } = await poolQuery(q, []);
    return rows;
}

async function deleteInviteCode(code) {
    const r = await poolQuery('DELETE FROM panel_invitation_codes WHERE code = $1', [code]);
    return r.rowCount > 0;
}

async function saveSession(token, userId, username, displayName, level, expiresAt, createdAt, lastActivity, sessionInfo = {}) {
    const ip = sessionInfo.ip || null;
    const ua = sessionInfo.userAgent || null;
    const country = sessionInfo.country || null;
    const city = sessionInfo.city || null;
    const device = sessionInfo.device || null;
    const os = sessionInfo.os || null;
    const browser = sessionInfo.browser || null;
    await poolQuery(
        `INSERT INTO panel_sessions (token, user_id, username, display_name, level, ip_address, user_agent, country, city, device, os, browser, expires_at, created_at, last_activity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (token) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           level = EXCLUDED.level,
           ip_address = EXCLUDED.ip_address,
           user_agent = EXCLUDED.user_agent,
           country = EXCLUDED.country,
           city = EXCLUDED.city,
           device = EXCLUDED.device,
           os = EXCLUDED.os,
           browser = EXCLUDED.browser,
           expires_at = EXCLUDED.expires_at,
           created_at = EXCLUDED.created_at,
           last_activity = EXCLUDED.last_activity`,
        [token, userId, username, displayName, level, ip, ua, country, city, device, os, browser, expiresAt, createdAt, lastActivity]
    );
}

async function getSessionFromDb(token) {
    const { rows } = await poolQuery('SELECT * FROM panel_sessions WHERE token = $1', [token]);
    return rows[0] || null;
}

async function deleteSessionFromDb(token) {
    await poolQuery('DELETE FROM panel_sessions WHERE token = $1', [token]);
}

async function deleteSessionsByUserId(userId) {
    const r = await poolQuery('DELETE FROM panel_sessions WHERE user_id = $1', [userId]);
    return r.rowCount;
}

async function deleteAllSessionsDb() {
    await poolQuery('DELETE FROM panel_sessions', []);
}

async function cleanupExpiredSessionsDb() {
    const r = await poolQuery('DELETE FROM panel_sessions WHERE expires_at < $1', [Date.now()]);
    return r.rowCount;
}

async function getActiveSessionsFromDb() {
    const { rows } = await poolQuery('SELECT * FROM panel_sessions WHERE expires_at > $1 ORDER BY last_activity DESC', [Date.now()]);
    return rows;
}

async function getSessionsByUserId(userId) {
    const { rows } = await poolQuery('SELECT * FROM panel_sessions WHERE user_id = $1 ORDER BY last_activity DESC', [userId]);
    return rows;
}

async function getUserByLauncherApiKey(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    const { rows } = await poolQuery('SELECT id, username, display_name, level, steam_id FROM panel_users WHERE launcher_api_key = $1', [k]);
    const u = rows[0];
    if (!u) return null;
    return {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        level: u.level,
        steamId: u.steam_id || null
    };
}

async function getActivityHeatmap(days = 30) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const { rows } = await poolQuery(`
        SELECT hour, EXTRACT(DOW FROM to_timestamp(timestamp/1000))::int as dow, AVG(total_players)::float as avg_players
        FROM panel_server_activity
        WHERE timestamp > $1
        GROUP BY dow, hour
        ORDER BY dow, hour
    `, [since]);
    const heatmap = Array.from({ length: 7 }, (_, dow) =>
        Array.from({ length: 24 }, (_, hour) => {
            const row = rows.find(r => r.dow === dow && r.hour === hour);
            return Math.round(row?.avg_players || 0);
        })
    );
    return heatmap;
}

async function replaceFearPunishments(adminSteamId, rows) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM panel_fear_punishments WHERE admin_steamid = $1', [adminSteamId]);
        if (rows.length > 0) {
            const values = [];
            const params = [];
            let idx = 1;
            for (const r of rows) {
                values.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
                params.push(
                    r.punishment_id, r.steamid, r.name, r.admin_steamid, r.admin_name,
                    r.reason, r.status, r.duration, r.created, r.expires,
                    r.type, r.punish_type, r.avatar, r.admin_avatar, Date.now()
                );
            }
            await client.query(
                `INSERT INTO panel_fear_punishments (punishment_id, steamid, name, admin_steamid, admin_name, reason, status, duration, created, expires, type, punish_type, avatar, admin_avatar, updated_at) VALUES ${values.join(',')}`,
                params
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function getFearPunishmentsStats(since = 0) {
    const { rows } = await poolQuery(
        `SELECT
            admin_steamid,
            COUNT(*) FILTER (WHERE (type = 0 OR punish_type = 0)) AS bans,
            COUNT(*) FILTER (WHERE (type = 1 OR punish_type = 1)) AS mutes,
            COUNT(*) AS total
         FROM panel_fear_punishments
         WHERE created >= $1
         GROUP BY admin_steamid
         ORDER BY total DESC`,
        [since]
    );
    return rows;
}

async function getFearPunishmentsByAdmin(adminSteamId, limit = 100, offset = 0) {
    const { rows } = await poolQuery(
        'SELECT * FROM panel_fear_punishments WHERE admin_steamid = $1 ORDER BY created DESC LIMIT $2 OFFSET $3',
        [adminSteamId, limit, offset]
    );
    return rows;
}

async function getStaffPunishmentsDaily(days = 7) {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const { rows } = await poolQuery(
        `SELECT to_timestamp(created)::date as day, admin_steamid, admin_name,
            COUNT(*) FILTER (WHERE (type = 0 OR punish_type = 0)) as bans,
            COUNT(*) FILTER (WHERE (type = 1 OR punish_type = 1)) as mutes,
            COUNT(*) as total
         FROM panel_fear_punishments
         WHERE created >= $1
         GROUP BY day, admin_steamid
         ORDER BY day DESC, total DESC`,
        [since]
    );
    return rows;
}

async function getPunishmentsTrend(days = 30) {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const { rows } = await poolQuery(
        `SELECT to_timestamp(created)::date as day,
            COUNT(*) FILTER (WHERE (type = 0 OR punish_type = 0)) as bans,
            COUNT(*) FILTER (WHERE (type = 1 OR punish_type = 1)) as mutes,
            COUNT(*) as total
         FROM panel_fear_punishments
         WHERE created >= $1
         GROUP BY day
         ORDER BY day ASC`,
        [since]
    );
    return rows;
}

async function getPunishmentsMonthComparison() {
    const now = new Date();
    const currYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const { rows: [curr] } = await poolQuery(
        `SELECT
            COUNT(*) FILTER (WHERE (type = 0 OR punish_type = 0)) as bans,
            COUNT(*) FILTER (WHERE (type = 1 OR punish_type = 1)) as mutes,
            COUNT(*) as total
         FROM panel_fear_punishments
         WHERE to_char(to_timestamp(created), 'YYYY-MM') = $1`,
        [currYm]
    );

    const { rows: [prev] } = await poolQuery(
        `SELECT
            COUNT(*) FILTER (WHERE (type = 0 OR punish_type = 0)) as bans,
            COUNT(*) FILTER (WHERE (type = 1 OR punish_type = 1)) as mutes,
            COUNT(*) as total
         FROM panel_fear_punishments
         WHERE to_char(to_timestamp(created), 'YYYY-MM') = $1`,
        [prevYm]
    );

    return { current: curr || { bans: 0, mutes: 0, total: 0 }, previous: prev || { bans: 0, mutes: 0, total: 0 } };
}

async function getTicketsMonthComparison() {
    const now = new Date();
    const currYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const { rows: [curr] } = await poolQuery(
        `SELECT COALESCE(SUM(tickets), 0) as total FROM panel_staff_tickets WHERE ym = $1`,
        [currYm]
    );
    const { rows: [prev] } = await poolQuery(
        `SELECT COALESCE(SUM(tickets), 0) as total FROM panel_staff_tickets WHERE ym = $1`,
        [prevYm]
    );

    return { current: curr?.total || 0, previous: prev?.total || 0 };
}

async function getActivityByServer(days = 7) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const { rows } = await poolQuery(
        'SELECT timestamp, server_data FROM panel_server_activity WHERE timestamp > $1 ORDER BY timestamp ASC',
        [since]
    );
    const serversMap = new Map();
    for (const row of rows) {
        let data;
        try { data = JSON.parse(row.server_data); } catch { continue; }
        if (!Array.isArray(data)) continue;
        for (const s of data) {
            const name = s.name || 'Unknown';
            if (!serversMap.has(name)) serversMap.set(name, []);
            serversMap.get(name).push({ timestamp: row.timestamp, players: Number(s.players) || 0 });
        }
    }
    const result = {};
    const bucketMs = 60 * 60 * 1000;
    for (const [name, points] of serversMap) {
        const hourly = new Map();
        for (const p of points) {
            const bucket = Math.floor(p.timestamp / bucketMs) * bucketMs;
            const existing = hourly.get(bucket);
            if (!existing || p.players > existing.players) hourly.set(bucket, p);
        }
        result[name] = Array.from(hourly.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([ts, p]) => ({ timestamp: ts, players: p.players }));
    }
    return result;
}

// --- VDF checks history (shared tables created by bot/checker) ---
async function getVdfHistoryChecks(limit = 100) {
    try {
        const { rows } = await poolQuery(`
            SELECT check_id,
                   (array_agg(filename ORDER BY id DESC))[1] AS filename,
                   MIN(created_at) AS created_at,
                   COUNT(*) AS count,
                   COUNT(*) FILTER (WHERE fear_banned OR vac_banned OR yooma_banned) AS banned_count,
                   (array_agg(source ORDER BY id DESC))[1] AS source
            FROM vdf_history
            GROUP BY check_id
            ORDER BY check_id DESC
            LIMIT $1
        `, [limit]);
        return rows.map(r => ({
            ...r,
            created_at: r.created_at ? (r.created_at.toISOString ? r.created_at.toISOString() : String(r.created_at)) : null
        }));
    } catch (e) {
        console.error('[panelPg] getVdfHistoryChecks error:', e && e.message);
        return [];
    }
}

async function getVdfHistoryBannedByConfigHash(configHash) {
    try {
        const { rows } = await poolQuery(`
            SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                   vac_banned, vac_days_ago, yooma_banned, yooma_reason, created_at
            FROM vdf_history
            WHERE config_hash = $1 AND (fear_banned = TRUE OR vac_banned = TRUE OR yooma_banned = TRUE)
            ORDER BY created_at DESC
        `, [configHash]);
        return rows.map(r => ({
            ...r,
            created_at: r.created_at ? (r.created_at.toISOString ? r.created_at.toISOString() : String(r.created_at)) : null
        }));
    } catch (e) {
        console.error('[panelPg] getVdfHistoryBannedByConfigHash error:', e && e.message);
        return [];
    }
}

async function getVdfHistoryDetails(check_id) {
    try {
        const { rows } = await poolQuery(`
            SELECT id, check_id, source, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                   vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
                   admin_group, config_hash, filename, attachment_url, message_url, on_fear, created_at
            FROM vdf_history
            WHERE check_id = $1
            ORDER BY id ASC
        `, [check_id]);
        return rows.map(r => ({
            ...r,
            created_at: r.created_at ? (r.created_at.toISOString ? r.created_at.toISOString() : String(r.created_at)) : null
        }));
    } catch (e) {
        console.error('[panelPg] getVdfHistoryDetails error:', e && e.message);
        return [];
    }
}

async function getVdfContentByCheckId(check_id) {
    try {
        const { rows } = await poolQuery(`
            SELECT ch.content, ch.filename
            FROM config_hashes ch
            JOIN vdf_history vh ON vh.config_hash = ch.config_hash
            WHERE vh.check_id = $1
            LIMIT 1
        `, [check_id]);
        if (!rows || rows.length === 0) return null;
        return { content: rows[0].content || '', filename: rows[0].filename || `check_${check_id}.vdf` };
    } catch (e) {
        console.error('[panelPg] getVdfContentByCheckId error:', e && e.message);
        return null;
    }
}

async function saveVdfHistory(results, filename = '', vdfText = '', source = 'site') {
    if (!Array.isArray(results) || results.length === 0) return null;
    const steamids = results.map(r => r.steamid).filter(Boolean);
    if (steamids.length === 0) return null;

    let configHash;
    if (vdfText) {
        configHash = crypto.createHash('sha256').update(vdfText).digest('hex').slice(0, 64);
    } else {
        configHash = crypto.createHash('sha256').update(steamids.join(',')).digest('hex').slice(0, 64);
    }

    try {
        await poolQuery(`
            CREATE SEQUENCE IF NOT EXISTS vdf_check_id_seq
            AS INTEGER
            START WITH 1
            INCREMENT BY 1
            NO CYCLE
        `);
        // Подгоняем последовательность только если она отстала от реального MAX(check_id).
        // Так бот и сайт не пересекутся, если один из них уже двигал последовательность.
        const { rows: seqRows } = await poolQuery(`SELECT last_value FROM vdf_check_id_seq`);
        const { rows: maxRows } = await poolQuery(`SELECT COALESCE(MAX(check_id), 0) AS max_check_id FROM vdf_history`);
        const seqLast = seqRows[0]?.last_value || 0;
        const maxCheckId = maxRows[0]?.max_check_id || 0;
        if (maxCheckId >= seqLast) {
            await poolQuery(`SELECT setval('vdf_check_id_seq', $1, false)`, [maxCheckId + 1]);
        }

        const { rows: nextRow } = await poolQuery(`SELECT nextval('vdf_check_id_seq') AS check_id`);
        const checkId = nextRow[0]?.check_id;
        if (!checkId || checkId <= 0) return null;

        await poolQuery(`
            INSERT INTO config_hashes (config_hash, filename, content)
            VALUES ($1, $2, $3)
            ON CONFLICT (config_hash) DO UPDATE
            SET filename = EXCLUDED.filename, content = EXCLUDED.content
        `, [configHash, filename || '', vdfText || '']);

        for (const sid of steamids) {
            await poolQuery(`
                INSERT INTO config_accounts (config_hash, steamid)
                VALUES ($1, $2)
                ON CONFLICT (config_hash, steamid) DO NOTHING
            `, [configHash, sid]);
        }

        // Удаляем предыдущие записи этого check_id, чтобы не дублировать строки
        // при повторном сохранении и чтобы сводка/детали показывали одинаковый набор.
        await poolQuery(`DELETE FROM vdf_history WHERE check_id = $1`, [checkId]);

        for (const r of results) {
            const ydata = r.yooma_data || {};
            const active = (ydata.punishments || []).find(p => p.status === 'active');
            const activeYooma = Boolean(active);
            const yoomaReason = active ? (active.reason || active.type_name || '') : '';
            await poolQuery(`
                INSERT INTO vdf_history
                    (check_id, source, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                     vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
                     admin_group, config_hash, filename, attachment_url, message_url, on_fear)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            `, [
                checkId,
                source,
                r.steamid || '',
                r.nickname || '',
                Boolean(r.fear_banned),
                r.fear_reason || '',
                r.fear_unban || '',
                Boolean(r.vac_banned),
                r.vac_days || 0,
                r.game_bans || 0,
                activeYooma,
                yoomaReason,
                r.admin_group || '',
                configHash,
                filename || '',
                '',
                '',
                Boolean(r.on_fear)
            ]);
        }
        return checkId;
    } catch (e) {
        console.error('[panelPg] saveVdfHistory error:', e && e.message);
        return null;
    }
}

async function logLoginEvent(userId, action, details = null, sessionInfo = {}) {
    const ip = sessionInfo.ip || null;
    const ua = sessionInfo.userAgent || null;
    const country = sessionInfo.country || null;
    const city = sessionInfo.city || null;
    const device = sessionInfo.device || null;
    const os = sessionInfo.os || null;
    const browser = sessionInfo.browser || null;
    const detailsJson = details ? JSON.stringify(details) : null;
    await poolQuery(
        `INSERT INTO panel_login_logs (user_id, ip_address, user_agent, country, city, device, os, browser, action, details, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [userId, ip, ua, country, city, device, os, browser, action, detailsJson, Date.now()]
    );
}

async function getLoginLogsByUserId(userId, limit = 50) {
    const { rows } = await poolQuery(
        'SELECT * FROM panel_login_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit]
    );
    return rows;
}

async function createRegistrationConfirmation(userId, discordId, confirmationCode, expiresAt) {
    const { rows } = await poolQuery(
        `INSERT INTO panel_registration_confirmations (user_id, discord_id, confirmation_code, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [userId, discordId, confirmationCode, 'pending', expiresAt, Date.now()]
    );
    return rows[0].id;
}

async function getPendingRegistrationConfirmation(userId) {
    const { rows } = await poolQuery(
        `SELECT * FROM panel_registration_confirmations
         WHERE user_id = $1 AND status = 'pending' AND expires_at > $2
         ORDER BY created_at DESC LIMIT 1`,
        [userId, Date.now()]
    );
    return rows[0] || null;
}

async function getRegistrationConfirmationByCode(code) {
    const { rows } = await poolQuery(
        `SELECT * FROM panel_registration_confirmations
         WHERE confirmation_code = $1 AND status = 'pending' AND expires_at > $2
         LIMIT 1`,
        [code, Date.now()]
    );
    return rows[0] || null;
}

async function updateRegistrationConfirmation(id, status, level = null) {
    const now = Date.now();
    const confirmedAt = status === 'confirmed' ? now : null;
    const rejectedAt = status === 'rejected' ? now : null;
    await poolQuery(
        `UPDATE panel_registration_confirmations
         SET status = $1, level = COALESCE($2, level), confirmed_at = COALESCE($3, confirmed_at), rejected_at = COALESCE($4, rejected_at)
         WHERE id = $5`,
        [status, level, confirmedAt, rejectedAt, id]
    );
}

async function createBotTask(type, payload) {
    const { rows } = await poolQuery(
        `INSERT INTO panel_bot_tasks (type, payload, status, created_at)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [type, JSON.stringify(payload), 'pending', Date.now()]
    );
    return rows[0].id;
}

async function getPendingBotTasks(type, limit = 10) {
    const { rows } = await poolQuery(
        `SELECT * FROM panel_bot_tasks WHERE type = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT $2`,
        [type, limit]
    );
    return rows;
}

async function updateBotTask(id, status, result = null) {
    await poolQuery(
        `UPDATE panel_bot_tasks SET status = $1, result = $2, processed_at = $3 WHERE id = $4`,
        [status, result ? JSON.stringify(result) : null, Date.now(), id]
    );
}

async function getRegistrationStatus(userId) {
    const { rows } = await poolQuery(
        `SELECT status, level, confirmed_at FROM panel_registration_confirmations
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

module.exports = {
    initialize,
    getDbPath,
    closeDatabase,
    initDatabase,
    logAction,
    getActionLogs,
    getActionLogsByUser,
    addToWhitelist,
    removeFromWhitelist,
    isWhitelisted,
    getWhitelistEntry,
    getWhitelist,
    addBanComment,
    getBanComments,
    deleteBanComment,
    saveServerActivity,
    getServerActivityByHour,
    getServerActivityHistory,
    getServerActivityRange,
    setSetting,
    getSetting,
    getAllSettings,
    setUserLevel,
    getUserLevel,
    removeUserLevel,
    getAllUserLevels,
    createUser,
    verifyUser,
    getUserById,
    getUserByDiscordId,
    getAllUsers,
    deleteUser,
    updateUserLevel,
    updateUserPassword,
    updateUserSteamId,
    createOrUpdateDiscordUser,
    getUserCount,
    deleteAllUsers,
    restoreUsersFromEnv,
    ensureUserLauncherApiKey,
    getUserByLauncherApiKey,
    createInviteCode,
    useInviteCode,
    validateInviteCode,
    getInviteCodes,
    deleteInviteCode,
    saveSession,
    getSessionFromDb,
    deleteSessionFromDb,
    deleteSessionsByUserId,
    deleteAllSessionsDb,
    cleanupExpiredSessionsDb,
    getActiveSessionsFromDb,
    upsertStaffTickets,
    getStaffTicketsByMonth,
    getStaffTicketsOne,
    upsertStaffRole,
    deleteStaffRole,
    getAllStaffRoles,
    upsertStaffCheckRank,
    deleteStaffCheckRank,
    getAllStaffCheckRanks,
    getActivityHeatmap,
    getActivityByServer,
    replaceFearPunishments,
    getFearPunishmentsStats,
    getFearPunishmentsByAdmin,
    getStaffPunishmentsDaily,
    getPunishmentsTrend,
    getPunishmentsMonthComparison,
    getTicketsMonthComparison,
    getVdfHistoryChecks,
    getVdfHistoryBannedByConfigHash,
    getVdfHistoryDetails,
    getVdfContentByCheckId,
    saveVdfHistory,
    createPendingUser,
    getUserBySteamId,
    updateUserStatusAndLevel,
    updateUserDiscordId,
    updateUserDiscordName,
    logLoginEvent,
    getLoginLogsByUserId,
    createRegistrationConfirmation,
    getPendingRegistrationConfirmation,
    getRegistrationConfirmationByCode,
    updateRegistrationConfirmation,
    createBotTask,
    getPendingBotTasks,
    updateBotTask,
    getRegistrationStatus,
    getSessionsByUserId,
    getLinkedSteamAccounts,
    getAllLinkedGroups,
    saveDrops,
    getDrops,
    getDropsCount,
    getDropsByPeriod
};

async function saveDrops(drops) {
    if (!Array.isArray(drops) || drops.length === 0) return 0;
    let inserted = 0;
    for (const d of drops) {
        const extId = Number(d.id);
        if (!Number.isFinite(extId)) continue;
        try {
            await poolQuery(`
                INSERT INTO drops (external_id, name, image, price, rarity_color, avatar, player_name, steamid, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (external_id) DO NOTHING
            `, [
                extId,
                String(d.name || ''),
                String(d.image || ''),
                String(d.price || ''),
                String(d.rarity_color || ''),
                String(d.avatar || ''),
                String(d.player_name || d.player || ''),
                String(d.steamid || ''),
                d.created_at ? new Date(d.created_at) : new Date()
            ]);
            inserted++;
        } catch (e) {
            console.error('[panelPg] saveDrops item error:', e && e.message);
        }
    }
    return inserted;
}

async function getDrops(limit = 1000, offset = 0) {
    try {
        const { rows } = await poolQuery(
            `SELECT id, external_id, name, image, price, rarity_color, avatar, player_name, steamid, created_at
             FROM drops ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return rows.map(r => ({
            id: r.external_id || r.id,
            name: r.name,
            image: r.image,
            price: r.price,
            rarity_color: r.rarity_color,
            avatar: r.avatar,
            player_name: r.player_name,
            steamid: r.steamid,
            created_at: r.created_at ? (r.created_at.toISOString ? r.created_at.toISOString() : String(r.created_at)) : null
        }));
    } catch (e) {
        console.error('[panelPg] getDrops error:', e && e.message);
        return [];
    }
}

async function getDropsCount() {
    try {
        const { rows } = await poolQuery('SELECT COUNT(*)::int AS cnt FROM drops');
        return rows[0]?.cnt || 0;
    } catch (e) {
        console.error('[panelPg] getDropsCount error:', e && e.message);
        return 0;
    }
}

async function getDropsByPeriod(period = 'all', limit = 1000, offset = 0) {
    try {
        let where = '';
        const params = [];
        if (period === 'day') {
            where = "WHERE created_at >= NOW() - INTERVAL '1 day'";
        } else if (period === 'week') {
            where = "WHERE created_at >= NOW() - INTERVAL '7 days'";
        } else if (period === 'month') {
            where = "WHERE created_at >= NOW() - INTERVAL '30 days'";
        }
        const { rows: countRows } = await poolQuery(
            `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(CAST(NULLIF(price, '') AS NUMERIC)), 0)::numeric AS total FROM drops ${where}`,
            params
        );
        const { cnt, total } = countRows[0] || { cnt: 0, total: 0 };
        const { rows } = await poolQuery(
            `SELECT id, external_id, name, image, price, rarity_color, avatar, player_name, steamid, created_at
             FROM drops ${where}
             ORDER BY created_at DESC, id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        const drops = rows.map(r => ({
            id: r.external_id || r.id,
            name: r.name,
            image: r.image,
            price: r.price,
            rarity_color: r.rarity_color,
            avatar: r.avatar,
            player_name: r.player_name,
            steamid: r.steamid,
            created_at: r.created_at ? (r.created_at.toISOString ? r.created_at.toISOString() : String(r.created_at)) : null
        }));
        return { drops, total: cnt, totalMoney: Number(total) || 0 };
    } catch (e) {
        console.error('[panelPg] getDropsByPeriod error:', e && e.message);
        return { drops: [], total: 0, totalMoney: 0 };
    }
}

async function getLinkedSteamAccounts(steamId) {
    try {
        if (!steamId) return null;
        const { rows: directRows } = await poolQuery(`
            SELECT ca.config_hash, ch.filename, ch.created_at
            FROM config_accounts ca
            JOIN config_hashes ch ON ch.config_hash = ca.config_hash
            WHERE ca.steamid = $1
            ORDER BY ch.created_at DESC
        `, [steamId]);
        if (!directRows || directRows.length === 0) return { steamId, linked: [] };
        const hashes = directRows.map(r => r.config_hash);
        const { rows: linkedRows } = await poolQuery(`
            SELECT DISTINCT ca2.steamid, ch.config_hash, ch.filename, ch.created_at
            FROM config_accounts ca2
            JOIN config_hashes ch ON ch.config_hash = ca2.config_hash
            WHERE ca2.config_hash = ANY($1) AND ca2.steamid <> $2
            ORDER BY ch.created_at DESC
        `, [hashes, steamId]);
        const seen = new Set();
        const linked = [];
        for (const r of linkedRows || []) {
            if (seen.has(r.steamid)) continue;
            seen.add(r.steamid);
            linked.push({
                steamId: r.steamid,
                configHash: r.config_hash,
                filename: r.filename,
                seenAt: r.created_at ? (r.created_at.toISOString ? r.created_at.toISOString() : String(r.created_at)) : null
            });
        }
        return { steamId, linked };
    } catch (e) {
        console.error('[panelPg] getLinkedSteamAccounts error:', e && e.message);
        return { steamId, linked: [], error: e && e.message };
    }
}

async function getAllLinkedGroups(limit = 100, offset = 0) {
    try {
        const { rows: groupRows } = await poolQuery(`
            SELECT ca.config_hash, ch.filename, ch.created_at, COUNT(*)::int AS account_count
            FROM config_accounts ca
            JOIN config_hashes ch ON ch.config_hash = ca.config_hash
            GROUP BY ca.config_hash, ch.filename, ch.created_at
            HAVING COUNT(*) > 1
            ORDER BY ch.created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const result = [];
        for (const g of groupRows || []) {
            const { rows: accounts } = await poolQuery(`
                SELECT steamid FROM config_accounts WHERE config_hash = $1
            `, [g.config_hash]);
            result.push({
                configHash: g.config_hash,
                filename: g.filename,
                createdAt: g.created_at ? (g.created_at.toISOString ? g.created_at.toISOString() : String(g.created_at)) : null,
                accountCount: g.account_count,
                steamIds: accounts.map(a => a.steamid)
            });
        }
        return result;
    } catch (e) {
        console.error('[panelPg] getAllLinkedGroups error:', e && e.message);
        return [];
    }
}
