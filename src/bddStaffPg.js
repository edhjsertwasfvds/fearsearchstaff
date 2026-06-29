/**
 * Чтение стаффа из PostgreSQL (схема VibeCodingBdd: admins + profiles).
 * Подключение: только DATABASE_URL.
 */

'use strict';

let _pool;

function getConnectionString() {
    return String(process.env.DATABASE_URL || '').trim();
}

function isConfigured() {
    return Boolean(getConnectionString());
}

function getPool() {
    const connectionString = getConnectionString();
    if (!connectionString) return null;
    if (_pool) return _pool;
    const { Pool } = require('pg');
    const ssl =
        /sslmode=require|ssl=true|railway\.app|neon\.tech|supabase\.co|render\.com|amazonaws\.com/i.test(connectionString) ||
        String(process.env.PG_SSL || '').trim() === '1'
            ? { rejectUnauthorized: false }
            : undefined;
    _pool = new Pool({
        connectionString,
        max: Math.min(8, Number(process.env.BDD_PG_POOL_MAX || 4) || 4),
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 12000,
        ssl
    });
    _pool.on('error', (err) => {
        console.error('[bddStaffPg] pool error:', err && err.message);
    });
    return _pool;
}

/**
 * @param {string} rawQ
 * @returns {Promise<object[]>}
 */
async function searchBddStaff(rawQ) {
    const pool = getPool();
    if (!pool) return [];
    const q = String(rawQ || '').trim();
    if (q.length < 2) return [];

    const staffBase = `
        SELECT
            a.steamid,
            a.group_display_name,
            a.group_name,
            a.is_frozen,
            a.avatar_full AS admin_avatar_full,
            p.name AS profile_name,
            p.last_activity,
            p.discord_id,
            p.discord_nickname,
            p.ban_is_banned,
            true AS is_staff
        FROM admins a
        LEFT JOIN profiles p ON p.steamid = a.steamid
    `;

    let staffSql = staffBase;
    const staffParams = [];

    if (/^\d{17}$/.test(q)) {
        staffSql += ' WHERE a.steamid = $1 ';
        staffParams.push(q);
    } else if (/^\d{10,20}$/.test(q)) {
        staffSql += ' WHERE (a.steamid = $1 OR (p.discord_id IS NOT NULL AND TRIM(p.discord_id) = $1)) ';
        staffParams.push(q);
    } else {
        const esc = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const like = `%${esc}%`;
        staffSql += ` WHERE (
            (a.name IS NOT NULL AND a.name ILIKE $1 ESCAPE '\\')
            OR (p.name IS NOT NULL AND p.name ILIKE $1 ESCAPE '\\')
            OR (p.discord_nickname IS NOT NULL AND p.discord_nickname ILIKE $1 ESCAPE '\\')
            OR a.steamid ILIKE $1 ESCAPE '\\'
            OR (p.discord_id IS NOT NULL AND p.discord_id ILIKE $1 ESCAPE '\\')
        ) `;
        staffParams.push(like);
    }

    staffSql += ' ORDER BY GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) DESC NULLS LAST LIMIT 50';

    const profileBase = `
        SELECT
            p.steamid,
            NULL::text AS group_display_name,
            NULL::text AS group_name,
            false AS is_frozen,
            p.avatar_full AS admin_avatar_full,
            p.name AS profile_name,
            p.last_activity,
            p.discord_id,
            p.discord_nickname,
            p.ban_is_banned,
            false AS is_staff
        FROM profiles p
    `;

    let profileSql = profileBase;
    const profileParams = [];

    if (/^\d{17}$/.test(q)) {
        profileSql += ' WHERE p.steamid = $1 ';
        profileParams.push(q);
    } else if (/^\d{10,20}$/.test(q)) {
        profileSql += ' WHERE (p.discord_id IS NOT NULL AND TRIM(p.discord_id) = $1) ';
        profileParams.push(q);
    } else {
        const esc = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const like = `%${esc}%`;
        profileSql += ` WHERE (
            (p.name IS NOT NULL AND p.name ILIKE $1 ESCAPE '\\')
            OR (p.discord_nickname IS NOT NULL AND p.discord_nickname ILIKE $1 ESCAPE '\\')
            OR (p.discord_id IS NOT NULL AND p.discord_id ILIKE $1 ESCAPE '\\')
            OR p.steamid ILIKE $1 ESCAPE '\\'
        ) `;
        profileParams.push(like);
    }

    profileSql += ' ORDER BY p.updated_at DESC NULLS LAST LIMIT 50';

    const [staffRes, profileRes] = await Promise.all([
        pool.query(staffSql, staffParams),
        pool.query(profileSql, profileParams)
    ]);

    const staffRows = staffRes.rows || [];
    const profileRows = profileRes.rows || [];

    const seen = new Set();
    const merged = [];
    for (const r of staffRows) {
        const sid = String(r.steamid || '').trim();
        if (sid && seen.has(sid)) continue;
        if (sid) seen.add(sid);
        merged.push(r);
    }
    for (const r of profileRows) {
        const sid = String(r.steamid || '').trim();
        if (sid && seen.has(sid)) continue;
        if (sid) seen.add(sid);
        merged.push(r);
    }

    return merged.slice(0, 50);
}

async function getStaffPunishments(adminSteamid, type, limit = 10000) {
    const pool = getPool();
    if (!pool) return [];
    const { rows } = await pool.query(
        `
        SELECT
            id,
            type,
            steamid,
            name,
            admin,
            admin_steamid,
            admin_avatar,
            avatar,
            reason,
            status,
            duration,
            created,
            expires,
            unban_price
        FROM punishments
        WHERE admin_steamid = $1 AND type = $2
        ORDER BY created DESC
        LIMIT $3
        `,
        [adminSteamid, type, limit]
    );
    return rows;
}

async function getStaffPunishmentStats(adminSteamids) {
    const pool = getPool();
    if (!pool) return {};
    if (!Array.isArray(adminSteamids) || adminSteamids.length === 0) return {};
    const { rows } = await pool.query(
        `
        SELECT admin_steamid, type, COUNT(*)::int as count
        FROM punishments
        WHERE admin_steamid = ANY($1)
        GROUP BY admin_steamid, type
        `,
        [adminSteamids]
    );
    const stats = {};
    for (const row of rows) {
        const sid = row.admin_steamid;
        if (!stats[sid]) stats[sid] = { bans: 0, mutes: 0 };
        if (Number(row.type) === 1) stats[sid].bans = row.count;
        if (Number(row.type) === 2) stats[sid].mutes = row.count;
    }
    return stats;
}

async function getDiscordBySteamIds(steamids) {
    const pool = getPool();
    if (!pool) return {};
    if (!Array.isArray(steamids) || steamids.length === 0) return {};
    const { rows } = await pool.query(
        `
        SELECT steamid, discord_id, discord_nickname
        FROM profiles
        WHERE steamid = ANY($1)
        `,
        [steamids]
    );
    const map = {};
    for (const row of rows) {
        map[row.steamid] = {
            discord_id: row.discord_id || '',
            discord_nickname: row.discord_nickname || ''
        };
    }
    return map;
}

module.exports = {
    isConfigured,
    searchBddStaff,
    getStaffPunishments,
    getStaffPunishmentStats,
    getDiscordBySteamIds
};
