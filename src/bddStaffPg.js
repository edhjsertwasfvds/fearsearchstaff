/**
 * Чтение стаффа из PostgreSQL (схема VibeCodingBdd: admins + profiles).
 * На Railway: тот же DATABASE_URL / BDD_DATABASE_URL, что и у сервиса синка.
 * @see https://github.com/VibeCodingMeta/VibeCodingBdd
 */

'use strict';

let _pool;

function getConnectionString() {
    return String(process.env.BDD_DATABASE_URL || process.env.DATABASE_URL || '').trim();
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

    const base = `
        SELECT
            a.admin_id,
            a.steamid,
            a.group_id,
            a.group_display_name,
            a.group_name,
            a.immunity,
            a.is_frozen,
            a.avatar_full AS admin_avatar_full,
            a.raw_json AS admin_raw_json,
            a.updated_at AS admin_updated_at,
            p.name AS profile_name,
            p.last_activity,
            p.avatar_full AS profile_avatar_full,
            p.discord_id,
            p.discord_nickname,
            p.rank,
            p.kills,
            p.deaths,
            p.playtime,
            p.ban_is_banned,
            p.vip_is_vip,
            p.raw_json AS profile_raw_json,
            p.updated_at AS profile_updated_at,
            GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) AS sort_ts
        FROM admins a
        LEFT JOIN profiles p ON p.steamid = a.steamid
    `;

    let sql = base;
    const params = [];

    if (/^\d{17}$/.test(q)) {
        sql += ' WHERE a.steamid = $1 ';
        params.push(q);
    } else if (/^\d{10,20}$/.test(q)) {
        sql += ' WHERE (a.steamid = $1 OR (p.discord_id IS NOT NULL AND TRIM(p.discord_id) = $1)) ';
        params.push(q);
    } else {
        const esc = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const like = `%${esc}%`;
        sql += ` WHERE (
            (p.discord_nickname IS NOT NULL AND p.discord_nickname ILIKE $1 ESCAPE '\\')
            OR (p.name IS NOT NULL AND p.name ILIKE $1 ESCAPE '\\')
            OR a.steamid ILIKE $1 ESCAPE '\\'
            OR (p.discord_id IS NOT NULL AND p.discord_id ILIKE $1 ESCAPE '\\')
        ) `;
        params.push(like);
    }

    sql += ' ORDER BY sort_ts DESC NULLS LAST LIMIT 50';

    const { rows } = await pool.query(sql, params);
    return rows;
}

module.exports = {
    isConfigured,
    searchBddStaff
};
