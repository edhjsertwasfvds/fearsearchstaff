/**
 * SQLite-бэкенд панели (sql.js). Подключается из database.js, если не задан PostgreSQL.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const defaultDbPath = path.resolve(__dirname, '..', 'data', 'fear-data.db');
let dbPath;
if (process.env.DATABASE_PATH) {
    dbPath = path.resolve(process.env.DATABASE_PATH);
} else if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    dbPath = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'fear-data.db');
} else {
    dbPath = defaultDbPath;
}

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

let db = null;
let SQL = null;

// Адаптер prepare для sql.js (совместимость с better-sqlite3)
function prepare(sql) {
    const stmt = SQL.Database.prototype.prepare.call(db, sql);
    return {
        run: (...params) => {
            if (params.length) stmt.bind(params);
            stmt.run();
            let changes = 0, lastInsertRowid = 0;
            try {
                const r = SQL.Database.prototype.exec.call(db, 'SELECT changes() as c, last_insert_rowid() as id');
                if (r[0] && r[0].values[0]) { changes = r[0].values[0][0] || 0; lastInsertRowid = r[0].values[0][1] || 0; }
            } catch (_) {}
            stmt.free();
            saveDb();
            return { changes, lastInsertRowid };
        },
        get: (...params) => {
            if (params.length) stmt.bind(params);
            const row = stmt.step() ? stmt.getAsObject() : undefined;
            stmt.free();
            return row;
        },
        all: (...params) => {
            if (params.length) stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();
            return rows;
        }
    };
}

function exec(sql) {
    db.exec(sql);
    saveDb();
}

function saveDb() {
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    } catch (e) {
        console.warn('[DB] Ошибка сохранения:', e.message);
    }
}

async function initialize() {
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }
    db.prepare = (sql) => prepare(sql);
    db.exec = (sql) => { SQL.Database.prototype.exec.call(db, sql); saveDb(); };
}

function getDbPath() { return dbPath; }

function generateLauncherApiKey() {
    return 'lfp_' + crypto.randomBytes(32).toString('base64url');
}

/** Один раз на пользователя: создаёт ключ в БД при отсутствии. */
function ensureUserLauncherApiKey(userId) {
    const id = Number(userId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const row = db.prepare('SELECT launcher_api_key FROM users WHERE id = ?').get(id);
    if (!row) return null;
    const existing = row.launcher_api_key != null && String(row.launcher_api_key).trim() !== '';
    if (existing) return String(row.launcher_api_key).trim();
    let key = generateLauncherApiKey();
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            db.prepare('UPDATE users SET launcher_api_key = ? WHERE id = ?').run(key, id);
            saveDb();
            return key;
        } catch (e) {
            if (String(e.message || '').includes('UNIQUE')) {
                key = generateLauncherApiKey();
            } else {
                console.warn('[DB] ensureUserLauncherApiKey:', e.message);
                return null;
            }
        }
    }
    return null;
}

function getUserByLauncherApiKey(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    const u = db.prepare('SELECT id, username, display_name, level, steam_id FROM users WHERE launcher_api_key = ?').get(k);
    if (!u) return null;
    return {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        level: u.level,
        steamId: u.steam_id || null
    };
}

function migrateAllUserLauncherKeys() {
    try {
        const rows = db.prepare(
            'SELECT id FROM users WHERE launcher_api_key IS NULL OR launcher_api_key = ?'
        ).all('');
        for (const r of rows) {
            ensureUserLauncherApiKey(r.id);
        }
    } catch (e) {
        console.warn('[DB] migrateAllUserLauncherKeys:', e.message);
    }
}

/**
 * Пользователи, которые должны существовать из env.
 * Поддержка:
 * 1) DEFAULT_USERS=username:password:level,...
 * 2) ADMIN_USERNAME + ADMIN_PASSWORD (+ ADMIN_LEVEL, ADMIN_DISPLAY_NAME)
 */
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

function closeDatabase() {
    try {
        if (db) {
            saveDb();
            db.close();
            db = null;
        }
    } catch (e) { /* ignore */ }
}

function initDatabase() {
    db.exec(`CREATE TABLE IF NOT EXISTS action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_discord_id TEXT NOT NULL, user_name TEXT NOT NULL,
        action_type TEXT NOT NULL, target_steam_id TEXT, target_name TEXT, details TEXT,
        timestamp INTEGER NOT NULL, ip_address TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS whitelist (
        id INTEGER PRIMARY KEY AUTOINCREMENT, steam_id TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL,
        added_by_discord_id TEXT NOT NULL, added_by_name TEXT NOT NULL, reason TEXT, added_at INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS ban_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, steam_id TEXT NOT NULL, ban_source TEXT NOT NULL,
        author_discord_id TEXT NOT NULL, author_name TEXT NOT NULL, comment TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS server_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, hour INTEGER NOT NULL,
        total_players INTEGER NOT NULL, total_admins INTEGER NOT NULL, server_data TEXT NOT NULL)`);
    // KD snapshots removed: table deleted to free disk space.
    db.exec('DROP TABLE IF EXISTS fear_player_snapshots');
    db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS user_levels (discord_id TEXT PRIMARY KEY, level INTEGER NOT NULL DEFAULT 1, added_at INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS invitation_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, level INTEGER NOT NULL DEFAULT 1,
        used_at INTEGER, created_by INTEGER, created_at INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL,
        level INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_activity INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`);
    try {
        db.exec('ALTER TABLE users ADD COLUMN steam_id TEXT');
    } catch (_) {}
    try {
        db.exec('ALTER TABLE users ADD COLUMN launcher_api_key TEXT');
    } catch (_) {}
    try {
        db.exec('ALTER TABLE users ADD COLUMN discord_id TEXT');
    } catch (_) {}
    try {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)');
    } catch (_) {}
    try {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_launcher_api_key ON users(launcher_api_key)');
    } catch (_) {}
    db.exec(`CREATE INDEX IF NOT EXISTS idx_action_logs_user ON action_logs(user_discord_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp ON action_logs(timestamp)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_whitelist_steam_id ON whitelist(steam_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ban_comments_steam_id ON ban_comments(steam_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_server_activity_timestamp ON server_activity(timestamp)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_server_activity_hour ON server_activity(hour)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

    // Ручные тикеты для расчёта зарплат/премий стаффа.
    // Один SteamID + месяц (YYYY-MM) -> значение.
    db.exec(`CREATE TABLE IF NOT EXISTS staff_tickets (
        steam_id TEXT NOT NULL,
        ym TEXT NOT NULL,
        tickets INTEGER NOT NULL DEFAULT 0,
        updated_by_user_id INTEGER,
        updated_by_username TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (steam_id, ym)
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_tickets_ym ON staff_tickets(ym)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_tickets_steam_id ON staff_tickets(steam_id)`);

    // Роли стаффа для расчёта выплат (ГА / СТА / СТМ / М / МЛ).
    db.exec(`CREATE TABLE IF NOT EXISTS staff_roles (
        steam_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        updated_by_user_id INTEGER,
        updated_by_username TEXT,
        updated_at INTEGER NOT NULL
    )`);
    // Ранги проверки стаффа (Бета / Гамма / Альфа / Метод).
    db.exec(`CREATE TABLE IF NOT EXISTS staff_check_ranks (
        steam_id TEXT PRIMARY KEY,
        rank TEXT NOT NULL DEFAULT '',
        updated_by_user_id INTEGER,
        updated_by_username TEXT,
        updated_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS fear_punishments (
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
        updated_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fear_pun_admin ON fear_punishments(admin_steamid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fear_pun_created ON fear_punishments(created)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fear_pun_status ON fear_punishments(status)`);
    // VDF history tables (mirrored from checker backend for SQLite fallback)
    db.exec(`CREATE TABLE IF NOT EXISTS config_hashes (
        config_hash TEXT PRIMARY KEY,
        filename TEXT,
        content TEXT,
        created_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS config_accounts (
        config_hash TEXT NOT NULL,
        steamid TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (config_hash, steamid)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS vdf_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id INTEGER NOT NULL,
        steamid TEXT NOT NULL,
        nickname TEXT,
        fear_banned INTEGER DEFAULT 0,
        fear_reason TEXT,
        fear_unban_time TEXT,
        vac_banned INTEGER DEFAULT 0,
        vac_days_ago INTEGER DEFAULT 0,
        game_bans INTEGER DEFAULT 0,
        yooma_banned INTEGER DEFAULT 0,
        yooma_reason TEXT,
        admin_group TEXT,
        config_hash TEXT,
        filename TEXT,
        attachment_url TEXT,
        message_url TEXT,
        on_fear INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vdf_history_steamid ON vdf_history(steamid)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vdf_history_check_id ON vdf_history(check_id)`);
    db.exec(`CREATE TABLE IF NOT EXISTS drops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id INTEGER UNIQUE,
        name TEXT,
        image TEXT,
        price TEXT,
        rarity_color TEXT,
        avatar TEXT,
        player_name TEXT,
        steamid TEXT,
        created_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_drops_created_at ON drops(created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_drops_steamid ON drops(steamid)`);
    const bootstrapUsers = getBootstrapUsersFromEnv();
    if (bootstrapUsers.length) {
        for (const u of bootstrapUsers) {
            const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
            if (!exists) {
                const hash = bcrypt.hashSync(u.password, 10);
                db.prepare('INSERT INTO users (username, password_hash, display_name, level, created_at) VALUES (?, ?, ?, ?, ?)').run(u.username, hash, u.displayName || u.username, u.level, Date.now());
                console.log(`[Auth] Пользователь "${u.username}" создан (level=${u.level})`);
            }
        }
    }
    migrateAllUserLauncherKeys();
    saveDb();
    console.log('✅ База данных инициализирована (sql.js)');
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

function upsertStaffTickets(steamId, ym, tickets, updatedByUserId, updatedByUsername) {
    const sid = String(steamId || '').trim();
    const m = normalizeYm(ym);
    if (!sid || !m) return false;
    const t = clampInt(tickets, 0, 1000000);
    const now = Date.now();
    db.prepare(
        `INSERT OR REPLACE INTO staff_tickets (steam_id, ym, tickets, updated_by_user_id, updated_by_username, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sid, m, t, updatedByUserId != null ? Number(updatedByUserId) : null, String(updatedByUsername || ''), now);
    return true;
}

function getStaffTicketsByMonth(ym) {
    const m = normalizeYm(ym);
    if (!m) return [];
    return db.prepare('SELECT steam_id, ym, tickets, updated_by_user_id, updated_by_username, updated_at FROM staff_tickets WHERE ym = ?').all(m);
}

function getStaffTicketsOne(steamId, ym) {
    const sid = String(steamId || '').trim();
    const m = normalizeYm(ym);
    if (!sid || !m) return null;
    const row = db.prepare('SELECT steam_id, ym, tickets, updated_by_user_id, updated_by_username, updated_at FROM staff_tickets WHERE steam_id = ? AND ym = ?').get(sid, m);
    return row || null;
}

function upsertStaffRole(steamId, role, updatedByUserId, updatedByUsername) {
    const sid = String(steamId || '').trim();
    const r = String(role || '').trim().toUpperCase();
    if (!sid || !r) return false;
    const now = Date.now();
    db.prepare(
        `INSERT OR REPLACE INTO staff_roles (steam_id, role, updated_by_user_id, updated_by_username, updated_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(sid, r, updatedByUserId != null ? Number(updatedByUserId) : null, String(updatedByUsername || ''), now);
    return true;
}

function deleteStaffRole(steamId) {
    const sid = String(steamId || '').trim();
    if (!sid) return false;
    const res = db.prepare('DELETE FROM staff_roles WHERE steam_id = ?').run(sid);
    return res.changes > 0;
}

function getAllStaffRoles() {
    return db.prepare('SELECT steam_id, role, updated_by_user_id, updated_by_username, updated_at FROM staff_roles').all();
}

function upsertStaffCheckRank(steamId, rank, updatedByUserId, updatedByUsername) {
    const sid = String(steamId || '').trim();
    const r = String(rank || '').trim();
    if (!sid || !r) return false;
    const now = Date.now();
    db.prepare(
        `INSERT OR REPLACE INTO staff_check_ranks (steam_id, rank, updated_by_user_id, updated_by_username, updated_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(sid, r, updatedByUserId != null ? Number(updatedByUserId) : null, String(updatedByUsername || ''), now);
    return true;
}

function deleteStaffCheckRank(steamId) {
    const sid = String(steamId || '').trim();
    if (!sid) return false;
    const res = db.prepare('DELETE FROM staff_check_ranks WHERE steam_id = ?').run(sid);
    return res.changes > 0;
}

function getAllStaffCheckRanks() {
    return db.prepare('SELECT steam_id, rank, updated_by_user_id, updated_by_username, updated_at FROM staff_check_ranks').all();
}

function logAction(userId, userName, actionType, targetSteamId, targetName, details, ipAddress) {
    db.prepare(`INSERT INTO action_logs (user_discord_id, user_name, action_type, target_steam_id, target_name, details, timestamp, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, userName, actionType, targetSteamId, targetName, details, Date.now(), ipAddress);
}
function getActionLogs(limit = 100, offset = 0) { return db.prepare(`SELECT * FROM action_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(limit, offset); }
function getActionLogsByUser(userId, limit = 50) { return db.prepare(`SELECT * FROM action_logs WHERE user_discord_id = ? ORDER BY timestamp DESC LIMIT ?`).all(userId, limit); }

function addToWhitelist(steamId, nickname, addedById, addedByName, reason) {
    db.prepare(`INSERT OR REPLACE INTO whitelist (steam_id, nickname, added_by_discord_id, added_by_name, reason, added_at) VALUES (?, ?, ?, ?, ?, ?)`).run(steamId, nickname, addedById, addedByName, reason, Date.now());
}
function removeFromWhitelist(steamId) { db.prepare('DELETE FROM whitelist WHERE steam_id = ?').run(steamId); }
function isWhitelisted(steamId) { return db.prepare('SELECT * FROM whitelist WHERE steam_id = ?').get(steamId) !== undefined; }
function getWhitelistEntry(steamId) { return db.prepare('SELECT added_by_discord_id FROM whitelist WHERE steam_id = ?').get(steamId) || null; }
function getWhitelist() { return db.prepare('SELECT * FROM whitelist ORDER BY added_at DESC').all(); }

function addBanComment(steamId, banSource, authorId, authorName, comment) {
    db.prepare(`INSERT INTO ban_comments (steam_id, ban_source, author_discord_id, author_name, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(steamId, banSource, authorId, authorName, comment, Date.now());
}
function getBanComments(steamId) { return db.prepare(`SELECT * FROM ban_comments WHERE steam_id = ? ORDER BY created_at DESC`).all(steamId); }
function deleteBanComment(commentId, authorId, userLevel) {
    const comment = db.prepare('SELECT author_discord_id FROM ban_comments WHERE id = ?').get(commentId);
    if (!comment) return false;
    if (comment.author_discord_id !== String(authorId) && !(userLevel && userLevel >= 4)) return false;
    const result = db.prepare('DELETE FROM ban_comments WHERE id = ?').run(commentId);
    return result.changes > 0;
}

function saveServerActivity(totalPlayers, totalAdmins, serverData) {
    const now = Date.now();
    const hour = new Date(now).getHours();
    db.prepare(`INSERT INTO server_activity (timestamp, hour, total_players, total_admins, server_data) VALUES (?, ?, ?, ?, ?)`).run(now, hour, totalPlayers, totalAdmins, JSON.stringify(serverData));
}
function getServerActivityByHour(days = 7) {
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);
    return db.prepare(`SELECT hour, AVG(total_players) as avg_players, AVG(total_admins) as avg_admins FROM server_activity WHERE timestamp > ? GROUP BY hour ORDER BY hour`).all(since);
}
function getServerActivityHistory(hours = 24) {
    const now = Date.now();
    const since = now - (hours * 60 * 60 * 1000);
    const bucketMs = 60 * 60 * 1000;
    const rows = db.prepare(`SELECT timestamp, total_players FROM server_activity WHERE timestamp > ? ORDER BY timestamp ASC`).all(since);
    const buckets = Array.from({ length: 24 }, (_, i) => ({ timestamp: since + i * bucketMs, total_players: 0 }));
    for (const row of rows) {
        const slot = Math.min(23, Math.floor((row.timestamp - since) / bucketMs));
        if (slot >= 0 && row.total_players > buckets[slot].total_players) buckets[slot].total_players = row.total_players;
    }
    return buckets;
}

function getServerActivityRange(range = 'day') {
    const now = Date.now();
    if (range === 'day') {
        const hours = 24;
        const bucketMs = 60 * 60 * 1000;
        const since = now - (hours * bucketMs);
        const rows = db.prepare(`SELECT timestamp, total_players FROM server_activity WHERE timestamp > ? ORDER BY timestamp ASC`).all(since);
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
        return buckets.map(b => ({
            timestamp: b.timestamp,
            total_players: b._count > 0 ? Math.round(b._sum / b._count) : 0
        }));
    }

    if (range === 'week') {
        const days = 7;
        const since = now - (days * 24 * 60 * 60 * 1000);
        const bucketMs = 24 * 60 * 60 * 1000;
        const rows = db.prepare(`
            SELECT timestamp, total_players
            FROM server_activity
            WHERE timestamp > ?
            ORDER BY timestamp ASC
        `).all(since);

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
        return buckets.map(b => ({
            timestamp: b.timestamp,
            total_players: b._count > 0 ? Math.round(b._sum / b._count) : 0
        }));
    }

    // all time: агрегируем по дням
    const dayMs = 24 * 60 * 60 * 1000;
    const minRow = db.prepare(`SELECT MIN(timestamp) as min_ts FROM server_activity`).get();
    const minTsRaw = minRow?.min_ts ? Number(minRow.min_ts) : now;
    const since = Math.floor(minTsRaw / dayMs) * dayMs;
    const until = Math.floor(now / dayMs) * dayMs;
    const dayCount = Math.max(1, Math.floor((until - since) / dayMs) + 1);

    const rows = db.prepare(`
        SELECT
            CAST((timestamp - ?) / ? AS INTEGER) AS day_idx,
            AVG(total_players) AS total_players
        FROM server_activity
        WHERE timestamp >= ?
        GROUP BY day_idx
        ORDER BY day_idx ASC
    `).all(since, dayMs, since);

    const buckets = Array.from({ length: dayCount }, (_, i) => ({ timestamp: since + i * dayMs, total_players: 0 }));
    for (const row of rows) {
        const idx = Number(row.day_idx);
        if (!Number.isFinite(idx) || idx < 0 || idx >= buckets.length) continue;
        buckets[idx].total_players = Number(row.total_players) || 0;
    }
    return buckets;
}

function setUserLevel(id, level) { db.prepare('INSERT OR REPLACE INTO user_levels (discord_id, level, added_at) VALUES (?, ?, ?)').run(id, level, Date.now()); }
function getUserLevel(id) { const row = db.prepare('SELECT level FROM user_levels WHERE discord_id = ?').get(id); return row ? row.level : 0; }
function removeUserLevel(id) { db.prepare('DELETE FROM user_levels WHERE discord_id = ?').run(id); }
function getAllUserLevels() { return db.prepare('SELECT * FROM user_levels ORDER BY level DESC, added_at DESC').all(); }

function setSetting(key, value) { db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value)); }
function getSetting(key, defaultValue = null) {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    if (row) { try { return JSON.parse(row.value); } catch (_) { return row.value; } }
    return defaultValue;
}
function getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const result = {};
    for (const row of rows) { try { result[row.key] = JSON.parse(row.value); } catch (_) { result[row.key] = row.value; } }
    return result;
}

function createUser(username, password, displayName, level = 1) {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password_hash, display_name, level, created_at, steam_id) VALUES (?, ?, ?, ?, ?, ?)').run(username, hash, displayName || username, level, Date.now(), null);
    const newId = result.lastInsertRowid;
    ensureUserLauncherApiKey(newId);
    return newId;
}
function createOrUpdateDiscordUser(discordId, username, displayName, level) {
    const existing = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(discordId);
    const safeUsername = username || 'discord_' + discordId;
    const safeDisplayName = displayName || safeUsername;
    const now = Date.now();
    if (existing) {
        db.prepare('UPDATE users SET username = ?, display_name = ?, level = ? WHERE id = ?').run(safeUsername, safeDisplayName, level, existing.id);
        return existing.id;
    }
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const hash = bcrypt.hashSync(tempPassword, 10);
    const result = db.prepare('INSERT INTO users (username, password_hash, display_name, level, created_at, steam_id, discord_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(safeUsername, hash, safeDisplayName, level, now, null, discordId);
    const newId = result.lastInsertRowid;
    ensureUserLauncherApiKey(newId);
    return newId;
}
function verifyUser(username, password) {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
    return { id: user.id, username: user.username, displayName: user.display_name, level: user.level, steamId: user.steam_id || null };
}
function getUserById(id) {
    const user = db.prepare('SELECT id, username, display_name, level, created_at, steam_id, discord_id FROM users WHERE id = ?').get(id);
    return user ? { id: user.id, username: user.username, displayName: user.display_name, level: user.level, createdAt: user.created_at, steamId: user.steam_id || null, discordId: user.discord_id || null } : null;
}
function getUserByDiscordId(discordId) {
    const user = db.prepare('SELECT id, username, display_name, level, created_at, steam_id, discord_id FROM users WHERE discord_id = ?').get(discordId);
    return user ? { id: user.id, username: user.username, displayName: user.display_name, level: user.level, createdAt: user.created_at, steamId: user.steam_id || null, discordId: user.discord_id || null } : null;
}
function getAllUsers() { return db.prepare('SELECT id, username, display_name, level, created_at, steam_id, discord_id FROM users ORDER BY level DESC, created_at ASC').all().map(u => ({ id: u.id, username: u.username, displayName: u.display_name, level: u.level, createdAt: u.created_at, steamId: u.steam_id || null, discordId: u.discord_id || null })); }
function deleteUser(id) { return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0; }
function updateUserLevel(id, level) { return db.prepare('UPDATE users SET level = ? WHERE id = ?').run(level, id).changes > 0; }
function updateUserPassword(id, newPassword) { const hash = bcrypt.hashSync(newPassword, 10); return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id).changes > 0; }
function updateUserSteamId(id, steamId) { return db.prepare('UPDATE users SET steam_id = ? WHERE id = ?').run(steamId || null, id).changes > 0; }
function getUserCount() { return db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt; }
function deleteAllUsers() { db.prepare('DELETE FROM users').run(); }

function restoreUsersFromEnv() {
    let restored = 0;
    const users = getBootstrapUsersFromEnv();
    if (!users.length) return restored;
    for (const u of users) {
        const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
        if (!exists) {
            const hash = bcrypt.hashSync(u.password, 10);
            db.prepare('INSERT INTO users (username, password_hash, display_name, level, created_at) VALUES (?, ?, ?, ?, ?)').run(u.username, hash, u.displayName || u.username, u.level, Date.now());
            restored++;
            console.log(`[Auth] Восстановлен пользователь "${u.username}" (level=${u.level})`);
        }
    }
    return restored;
}

function createInviteCode(level, createdBy) {
    const crypto = require('crypto');
    const code = crypto.randomBytes(12).toString('base64url');
    db.prepare('INSERT INTO invitation_codes (code, level, created_by, created_at) VALUES (?, ?, ?, ?)').run(code, level, createdBy || null, Date.now());
    return code;
}
function validateInviteCode(code) { const row = db.prepare('SELECT level FROM invitation_codes WHERE code = ? AND used_at IS NULL').get(code); return row ? row.level : null; }
function useInviteCode(code) {
    const row = db.prepare('SELECT * FROM invitation_codes WHERE code = ? AND used_at IS NULL').get(code);
    if (!row) return null;
    db.prepare('UPDATE invitation_codes SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
    return row.level;
}
function getInviteCodes(includeUsed = false) {
    return includeUsed ? db.prepare('SELECT * FROM invitation_codes ORDER BY created_at DESC').all() : db.prepare('SELECT * FROM invitation_codes WHERE used_at IS NULL ORDER BY created_at DESC').all();
}
function deleteInviteCode(code) {
    return db.prepare('DELETE FROM invitation_codes WHERE code = ?').run(code).changes > 0;
}

function saveSession(token, userId, username, displayName, level, expiresAt, createdAt, lastActivity) {
    db.prepare(`INSERT OR REPLACE INTO sessions (token, user_id, username, display_name, level, expires_at, created_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(token, userId, username, displayName, level, expiresAt, createdAt, lastActivity);
}
function getSessionFromDb(token) { return db.prepare('SELECT * FROM sessions WHERE token = ?').get(token); }
function deleteSessionFromDb(token) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); }
function deleteSessionsByUserId(userId) { return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes > 0; }
function deleteAllSessionsDb() { db.prepare('DELETE FROM sessions').run(); }
function cleanupExpiredSessionsDb() { return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes; }
function getActiveSessionsFromDb() { return db.prepare('SELECT * FROM sessions WHERE expires_at > ?').all(Date.now()); }

function getActivityHeatmap(days = 30) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = db.prepare(`
        SELECT hour, CAST(strftime('%w', timestamp/1000, 'unixepoch') AS INTEGER) as dow, AVG(total_players) as avg_players
        FROM server_activity
        WHERE timestamp > ?
        GROUP BY dow, hour
        ORDER BY dow, hour
    `).all(since);
    const heatmap = Array.from({ length: 7 }, (_, dow) =>
        Array.from({ length: 24 }, (_, hour) => {
            const row = rows.find(r => r.dow === dow && r.hour === hour);
            return Math.round(row?.avg_players || 0);
        })
    );
    return heatmap;
}

function getActivityByServer(days = 7) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = db.prepare(`SELECT timestamp, server_data FROM server_activity WHERE timestamp > ? ORDER BY timestamp ASC`).all(since);
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

function replaceFearPunishments(adminSteamId, rows) {
    db.prepare('DELETE FROM fear_punishments WHERE admin_steamid = ?').run(adminSteamId);
    const insert = db.prepare(`INSERT INTO fear_punishments (punishment_id, steamid, name, admin_steamid, admin_name, reason, status, duration, created, expires, type, punish_type, avatar, admin_avatar, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) {
        insert.run(
            r.punishment_id, r.steamid, r.name, r.admin_steamid, r.admin_name,
            r.reason, r.status, r.duration, r.created, r.expires,
            r.type, r.punish_type, r.avatar, r.admin_avatar, Date.now()
        );
    }
    saveDb();
}

function getFearPunishmentsStats(since = 0) {
    return db.prepare(
        `SELECT
            admin_steamid,
            SUM(CASE WHEN (type = 0 OR punish_type = 0) THEN 1 ELSE 0 END) AS bans,
            SUM(CASE WHEN (type = 1 OR punish_type = 1) THEN 1 ELSE 0 END) AS mutes,
            COUNT(*) AS total
         FROM fear_punishments
         WHERE created >= ?
         GROUP BY admin_steamid
         ORDER BY total DESC`
    ).all(since);
}

function getFearPunishmentsByAdmin(adminSteamId, limit = 100, offset = 0) {
    return db.prepare(
        'SELECT * FROM fear_punishments WHERE admin_steamid = ? ORDER BY created DESC LIMIT ? OFFSET ?'
    ).all(adminSteamId, limit, offset);
}

function getStaffPunishmentsDaily(days = 7) {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    return db.prepare(
        `SELECT date(created, 'unixepoch') as day, admin_steamid, admin_name,
            SUM(CASE WHEN (type = 0 OR punish_type = 0) THEN 1 ELSE 0 END) as bans,
            SUM(CASE WHEN (type = 1 OR punish_type = 1) THEN 1 ELSE 0 END) as mutes,
            COUNT(*) as total
         FROM fear_punishments
         WHERE created >= ?
         GROUP BY day, admin_steamid
         ORDER BY day DESC, total DESC`
    ).all(since);
}

function getPunishmentsTrend(days = 30) {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    return db.prepare(
        `SELECT date(created, 'unixepoch') as day,
            SUM(CASE WHEN (type = 0 OR punish_type = 0) THEN 1 ELSE 0 END) as bans,
            SUM(CASE WHEN (type = 1 OR punish_type = 1) THEN 1 ELSE 0 END) as mutes,
            COUNT(*) as total
         FROM fear_punishments
         WHERE created >= ?
         GROUP BY day
         ORDER BY day ASC`
    ).all(since);
}

function getPunishmentsMonthComparison() {
    const now = new Date();
    const currYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const curr = db.prepare(
        `SELECT
            SUM(CASE WHEN (type = 0 OR punish_type = 0) THEN 1 ELSE 0 END) as bans,
            SUM(CASE WHEN (type = 1 OR punish_type = 1) THEN 1 ELSE 0 END) as mutes,
            COUNT(*) as total
         FROM fear_punishments
         WHERE strftime('%Y-%m', created, 'unixepoch') = ?`
    ).get(currYm);

    const prev = db.prepare(
        `SELECT
            SUM(CASE WHEN (type = 0 OR punish_type = 0) THEN 1 ELSE 0 END) as bans,
            SUM(CASE WHEN (type = 1 OR punish_type = 1) THEN 1 ELSE 0 END) as mutes,
            COUNT(*) as total
         FROM fear_punishments
         WHERE strftime('%Y-%m', created, 'unixepoch') = ?`
    ).get(prevYm);

    return { current: curr || { bans: 0, mutes: 0, total: 0 }, previous: prev || { bans: 0, mutes: 0, total: 0 } };
}

function getTicketsMonthComparison() {
    const now = new Date();
    const currYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const curr = db.prepare(`SELECT COALESCE(SUM(tickets), 0) as total FROM staff_tickets WHERE ym = ?`).get(currYm);
    const prev = db.prepare(`SELECT COALESCE(SUM(tickets), 0) as total FROM staff_tickets WHERE ym = ?`).get(prevYm);

    return { current: curr?.total || 0, previous: prev?.total || 0 };
}

// VDF history helpers (SQLite fallback; shared with checker backend)
function getVdfHistoryChecks(limit = 100) {
    const rows = db.prepare(`
        SELECT check_id, filename, MIN(created_at) as created_at,
               COUNT(*) as count,
               SUM(CASE WHEN fear_banned OR vac_banned OR yooma_banned THEN 1 ELSE 0 END) as banned_count
        FROM vdf_history
        GROUP BY check_id, filename
        ORDER BY check_id DESC
        LIMIT ?
    `).all(limit);
    return rows.map(r => ({
        check_id: r.check_id,
        filename: r.filename || '',
        created_at: r.created_at,
        count: r.count || 0,
        banned_count: r.banned_count || 0
    }));
}

function getVdfHistoryBannedByConfigHash(configHash) {
    try {
        return db.prepare(`
            SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                   vac_banned, vac_days_ago, yooma_banned, yooma_reason, created_at
            FROM vdf_history
            WHERE config_hash = ? AND (fear_banned = 1 OR vac_banned = 1 OR yooma_banned = 1)
            ORDER BY created_at DESC
        `).all(configHash);
    } catch (e) {
        console.error('[panelSqlite] getVdfHistoryBannedByConfigHash error:', e && e.message);
        return [];
    }
}

function getVdfHistoryDetails(check_id) {
    return db.prepare(`
        SELECT id, check_id, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
               vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
               admin_group, filename, on_fear, created_at
        FROM vdf_history
        WHERE check_id = ?
        ORDER BY id
    `).all(check_id);
}

function getVdfContentByCheckId(check_id) {
    const row = db.prepare(`
        SELECT ch.content, ch.filename
        FROM config_hashes ch
        JOIN vdf_history vh ON vh.config_hash = ch.config_hash
        WHERE vh.check_id = ?
        LIMIT 1
    `).get(check_id);
    if (!row) return null;
    return { content: row.content || '', filename: row.filename || `check_${check_id}.vdf` };
}

function saveVdfHistory(results, filename = '', vdfText = '') {
    if (!Array.isArray(results) || results.length === 0) return null;
    const steamids = results.map(r => r.steamid).filter(Boolean);
    if (steamids.length === 0) return null;

    let configHash;
    if (vdfText) {
        configHash = crypto.createHash('sha256').update(vdfText).digest('hex').slice(0, 64);
    } else {
        configHash = crypto.createHash('sha256').update(steamids.join(',')).digest('hex').slice(0, 64);
    }

    const maxRow = db.prepare('SELECT COALESCE(MAX(check_id), 0) AS max_check_id FROM vdf_history').get();
    const checkId = (maxRow?.max_check_id || 0) + 1;

    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
        INSERT INTO config_hashes (config_hash, filename, content, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(config_hash) DO UPDATE SET
            filename = excluded.filename,
            content = excluded.content,
            created_at = excluded.created_at
    `).run(configHash, filename || '', vdfText || '', now);

    const insertAccount = db.prepare(`
        INSERT INTO config_accounts (config_hash, steamid, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(config_hash, steamid) DO NOTHING
    `);
    for (const sid of steamids) {
        insertAccount.run(configHash, sid, now);
    }

    db.prepare('DELETE FROM vdf_history WHERE check_id = ?').run(checkId);

    const insertHistory = db.prepare(`
        INSERT INTO vdf_history
            (check_id, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
             vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
             admin_group, config_hash, filename, attachment_url, message_url, on_fear, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of results) {
        const ydata = r.yooma_data || {};
        const activeYooma = (ydata.punishments || []).some(p => p.status === 'active');
        const yoomaReason = activeYooma
            ? (ydata.punishments.find(p => p.status === 'active').reason || ydata.punishments.find(p => p.status === 'active').type_name || '')
            : '';
        insertHistory.run(
            checkId,
            r.steamid || '',
            r.nickname || '',
            r.fear_banned ? 1 : 0,
            r.fear_reason || '',
            r.fear_unban || '',
            r.vac_banned ? 1 : 0,
            r.vac_days || 0,
            r.game_bans || 0,
            activeYooma ? 1 : 0,
            yoomaReason,
            r.admin_group || '',
            configHash,
            filename || '',
            '',
            '',
            r.on_fear ? 1 : 0,
            now
        );
    }
    return checkId;
}

// Заглушки для функций, которые пока не реализованы в SQLite-бэкенде.
// На Railway используется PostgreSQL, поэтому эти методы нужны только для
// локальных запусков и smoke-тестов, чтобы сервер не падал с "is not a function".
function logLoginEvent() { return Promise.resolve(); }
function getLoginLogsByUserId() { return Promise.resolve([]); }
function getSessionsByUserId() { return Promise.resolve([]); }
function getUserBySteamId(steamId) {
    try {
        return db.prepare('SELECT * FROM users WHERE steam_id = ?').get(steamId) || null;
    } catch (e) {
        console.warn('[panelSqlite] getUserBySteamId error:', e && e.message);
        return null;
    }
}
function createPendingUser(username, password, displayName, steamId) {
    return createUser(username, password, { displayName, level: 0, steamId, status: 'pending' });
}
function createRegistrationConfirmation(userId) { return Promise.resolve({ id: 0, user_id: userId, code: '', status: 'pending' }); }
function getRegistrationConfirmationByCode() { return Promise.resolve(null); }
function updateRegistrationConfirmation() { return Promise.resolve(); }
function getRegistrationStatus() { return Promise.resolve({ status: 'pending', level: 0 }); }
function updateUserStatusAndLevel(id, status, level) {
    try {
        db.prepare('UPDATE users SET status = ?, level = ? WHERE id = ?').run(status, level, id);
        return Promise.resolve();
    } catch (e) {
        console.warn('[panelSqlite] updateUserStatusAndLevel error:', e && e.message);
        return Promise.resolve();
    }
}
function updateUserDiscordId(id, discordId) {
    try {
        db.prepare('UPDATE users SET discord_id = ? WHERE id = ?').run(discordId, id);
        return Promise.resolve();
    } catch (e) {
        console.warn('[panelSqlite] updateUserDiscordId error:', e && e.message);
        return Promise.resolve();
    }
}
function createBotTask(type, payload) { return Promise.resolve({ id: 0, type, payload: JSON.stringify(payload), status: 'pending' }); }
function getPendingBotTasks() { return Promise.resolve([]); }
function updateBotTask() { return Promise.resolve(); }

module.exports = {
    initialize,
    getDbPath, closeDatabase, initDatabase,
    logAction, getActionLogs, getActionLogsByUser,
    addToWhitelist, removeFromWhitelist, isWhitelisted, getWhitelistEntry, getWhitelist,
    addBanComment, getBanComments, deleteBanComment,
    saveServerActivity, getServerActivityByHour, getServerActivityHistory, getServerActivityRange,
    setSetting, getSetting, getAllSettings,
    setUserLevel, getUserLevel, removeUserLevel, getAllUserLevels,
    createUser, verifyUser, getUserById, getUserByDiscordId, getAllUsers, deleteUser, updateUserLevel, updateUserPassword, updateUserSteamId, createOrUpdateDiscordUser, getUserCount, deleteAllUsers, restoreUsersFromEnv,
    ensureUserLauncherApiKey, getUserByLauncherApiKey,
    createInviteCode, useInviteCode, validateInviteCode, getInviteCodes, deleteInviteCode,
    saveSession, getSessionFromDb, deleteSessionFromDb, deleteSessionsByUserId, deleteAllSessionsDb, cleanupExpiredSessionsDb, getActiveSessionsFromDb,
    upsertStaffTickets, getStaffTicketsByMonth, getStaffTicketsOne,
    upsertStaffRole,
    deleteStaffRole,
    getAllStaffRoles,
    upsertStaffCheckRank,
    deleteStaffCheckRank,
    getAllStaffCheckRanks,
    getActivityHeatmap, getActivityByServer,
    replaceFearPunishments, getFearPunishmentsStats, getFearPunishmentsByAdmin,
    getStaffPunishmentsDaily, getPunishmentsTrend, getPunishmentsMonthComparison, getTicketsMonthComparison,
    getVdfHistoryChecks, getVdfHistoryBannedByConfigHash, getVdfHistoryDetails, getVdfContentByCheckId, saveVdfHistory,
    getLinkedSteamAccounts, getAllLinkedGroups,
    saveDrops, getDrops, getDropsCount,
    logLoginEvent, getLoginLogsByUserId, getSessionsByUserId,
    getUserBySteamId, createPendingUser, createRegistrationConfirmation,
    createBotTask, getRegistrationStatus, getRegistrationConfirmationByCode,
    updateUserStatusAndLevel, updateRegistrationConfirmation, updateBotTask,
    getPendingBotTasks, updateUserDiscordId
};

function saveDrops(drops) {
    if (!Array.isArray(drops) || drops.length === 0) return 0;
    const insert = db.prepare(`
        INSERT INTO drops (external_id, name, image, price, rarity_color, avatar, player_name, steamid, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (external_id) DO UPDATE SET
            name = excluded.name,
            image = excluded.image,
            price = excluded.price,
            rarity_color = excluded.rarity_color,
            avatar = excluded.avatar,
            player_name = excluded.player_name,
            steamid = excluded.steamid,
            created_at = excluded.created_at
    `);
    let inserted = 0;
    const now = Date.now();
    for (const d of drops) {
        const extId = Number(d.id);
        if (!Number.isFinite(extId)) continue;
        try {
            insert.run(
                extId,
                String(d.name || ''),
                String(d.image || ''),
                String(d.price || ''),
                String(d.rarity_color || ''),
                String(d.avatar || ''),
                String(d.player_name || d.player || ''),
                String(d.steamid || ''),
                d.created_at ? new Date(d.created_at).getTime() : now
            );
            inserted++;
        } catch (e) {
            console.error('[panelSqlite] saveDrops item error:', e && e.message);
        }
    }
    return inserted;
}

function getDrops(limit = 1000, offset = 0) {
    try {
        const rows = db.prepare(
            `SELECT id, external_id, name, image, price, rarity_color, avatar, player_name, steamid, created_at
             FROM drops ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
        ).all(limit, offset);
        return rows.map(r => ({
            id: r.external_id || r.id,
            name: r.name,
            image: r.image,
            price: r.price,
            rarity_color: r.rarity_color,
            avatar: r.avatar,
            player_name: r.player_name,
            steamid: r.steamid,
            created_at: r.created_at ? new Date(r.created_at).toISOString() : null
        }));
    } catch (e) {
        console.error('[panelSqlite] getDrops error:', e && e.message);
        return [];
    }
}

function getDropsCount() {
    try {
        return db.prepare('SELECT COUNT(*) AS cnt FROM drops').get().cnt || 0;
    } catch (e) {
        console.error('[panelSqlite] getDropsCount error:', e && e.message);
        return 0;
    }
}

function getLinkedSteamAccounts(steamId) {
    try {
        if (!steamId) return null;
        const directRows = db.prepare(`
            SELECT ca.config_hash, ch.filename, ch.created_at
            FROM config_accounts ca
            JOIN config_hashes ch ON ch.config_hash = ca.config_hash
            WHERE ca.steamid = ?
            ORDER BY ch.created_at DESC
        `).all(steamId);
        if (!directRows || directRows.length === 0) return { steamId, linked: [] };
        const hashes = directRows.map(r => r.config_hash);
        const placeholders = hashes.map(() => '?').join(',');
        const linkedRows = db.prepare(`
            SELECT DISTINCT ca2.steamid, ch.config_hash, ch.filename, ch.created_at
            FROM config_accounts ca2
            JOIN config_hashes ch ON ch.config_hash = ca2.config_hash
            WHERE ca2.config_hash IN (${placeholders}) AND ca2.steamid <> ?
            ORDER BY ch.created_at DESC
        `).all(...hashes, steamId);
        const seen = new Set();
        const linked = [];
        for (const r of linkedRows || []) {
            if (seen.has(r.steamid)) continue;
            seen.add(r.steamid);
            linked.push({
                steamId: r.steamid,
                configHash: r.config_hash,
                filename: r.filename,
                seenAt: r.created_at ? String(r.created_at) : null
            });
        }
        return { steamId, linked };
    } catch (e) {
        console.error('[panelSqlite] getLinkedSteamAccounts error:', e && e.message);
        return { steamId, linked: [], error: e && e.message };
    }
}

function getAllLinkedGroups(limit = 100, offset = 0) {
    try {
        const groupRows = db.prepare(`
            SELECT ca.config_hash, ch.filename, ch.created_at, COUNT(*) AS account_count
            FROM config_accounts ca
            JOIN config_hashes ch ON ch.config_hash = ca.config_hash
            GROUP BY ca.config_hash
            HAVING account_count > 1
            ORDER BY ch.created_at DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);
        const result = [];
        for (const g of groupRows || []) {
            const accounts = db.prepare('SELECT steamid FROM config_accounts WHERE config_hash = ?').all(g.config_hash);
            result.push({
                configHash: g.config_hash,
                filename: g.filename,
                createdAt: g.created_at ? new Date(Number(g.created_at) * 1000).toISOString() : null,
                accountCount: g.account_count,
                steamIds: accounts.map(a => a.steamid)
            });
        }
        return result;
    } catch (e) {
        console.error('[panelSqlite] getAllLinkedGroups error:', e && e.message);
        return [];
    }
}
