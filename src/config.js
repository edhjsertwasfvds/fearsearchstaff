const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.fearproject.ru/servers';
const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const FEAR_COOKIE = process.env.FEAR_COOKIE || '';
const FEAR_ACCESS_TOKEN = process.env.FEAR_ACCESS_TOKEN || (() => {
    const m = FEAR_COOKIE.match(/access_token=([^;\s]+)/);
    return m ? decodeURIComponent(m[1]) : '';
})();
const FACEIT_API_KEY = process.env.FACEIT_API_KEY || '';
const CSSTATS_COOKIE = process.env.CSSTATS_COOKIE || '';
const DXDCS_COOKIE = process.env.DXDCS_COOKIE || '';
function stripQuotes(s) {
    s = String(s || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}
const DISCORD_BOT_TOKEN = stripQuotes(process.env.DISCORD_BOT_TOKEN);
const DISCORD_CLIENT_ID = stripQuotes(process.env.DISCORD_CLIENT_ID);
const DISCORD_CLIENT_SECRET = stripQuotes(process.env.DISCORD_CLIENT_SECRET);
const DISCORD_REDIRECT_URI = stripQuotes(process.env.DISCORD_REDIRECT_URI || process.env.DISCORD_REDIRECT_URL);
const DISCORD_GUILD_ID = stripQuotes(process.env.DISCORD_GUILD_ID);
const DISCORD_DEFAULT_LEVEL = Math.min(5, Math.max(0, Number(process.env.DISCORD_DEFAULT_LEVEL || '0')));
const DISCORD_ROLE_LEVELS = (() => {
    const map = {};
    // Явная карта role_id:level
    const raw = process.env.DISCORD_ROLE_LEVELS || '';
    if (raw) {
        for (const part of raw.split(',')) {
            const [roleId, levelStr] = part.split(':');
            if (!roleId || !levelStr) continue;
            const level = Math.min(5, Math.max(0, Number(levelStr.trim()) || 0));
            map[roleId.trim()] = level;
        }
    }
    // Или отдельные переменные DISCORD_ROLE_<NAME> — удобно для Railway
    const roleEnvMapping = {
        DISCORD_ROLE_OWNER: 5,
        DISCORD_ROLE_GLADMIN: 5,
        DISCORD_ROLE_STADMIN: 5,
        DISCORD_ROLE_ADMIN_PLUS: 4,
        DISCORD_ROLE_ADMIN: 4,
        DISCORD_ROLE_STMODER: 3,
        DISCORD_ROLE_MODER: 3,
        DISCORD_ROLE_MLMODER: 2,
        DISCORD_ROLE_CURATOR: 1,
        DISCORD_ROLE_DOSTUP: 1,
        DISCORD_ROLE_UNDEFINED: 0
    };
    for (const [envName, level] of Object.entries(roleEnvMapping)) {
        const roleId = stripQuotes(process.env[envName]);
        if (roleId) map[roleId] = level;
    }
    return map;
})();
const DISCORD_FORCE_LEVEL_5_IDS = (() => {
    const raw = process.env.DISCORD_FORCE_LEVEL_5_IDS || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
})();
const DISCORD_BLOCKED_ROLE_IDS = (() => {
    const raw = process.env.DISCORD_BLOCKED_ROLE_IDS || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
})();
const DISCORD_STATE_SECRET = process.env.DISCORD_STATE_SECRET || process.env.SITE_API_SECRET || crypto.randomBytes(32).toString('hex');
const PUNISHMENTS_ADMIN_STEAM_ID = process.env.PUNISHMENTS_ADMIN_STEAM_ID || '';
const FEAR_PUNISHMENTS_ADMIN_IDS = (process.env.FEAR_PUNISHMENTS_ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{17}$/.test(s));
const FEAR_PUNISHMENTS_REFRESH_HOURS = Math.max(0.5, Math.min(24, Number(process.env.FEAR_PUNISHMENTS_REFRESH_HOURS || 1)));
const FEAR_PUNISHMENTS_REFRESH_MS = Math.floor(FEAR_PUNISHMENTS_REFRESH_HOURS * 60 * 60 * 1000);
/** Bearer или ?token= для GET /api/moderator/players (машинный доступ с Railway и т.п.) */
const MODERATOR_API_TOKEN = (process.env.MODERATOR_API_TOKEN || '').trim();
/** Опционально: общий машинный ключ для GET /api/launcher/players (помимо личных ключей пользователей в БД). */
const LAUNCHER_API_KEY = (process.env.LAUNCHER_API_KEY || '').trim();
/** Устаревшее имя; то же назначение, что LAUNCHER_API_KEY */
const LAUNCHER_API_TOKEN = (process.env.LAUNCHER_API_TOKEN || '').trim();

// Уровни доступа: 1-2 = просмотр, 3 = whitelist/логи, 4 = админ, 5 = суперадмин
const USER_LEVEL_WHITELIST = 3;
const USER_LEVEL_ADMIN = 4;
const USER_LEVEL_SUPER = 5;

// Таймауты (мс)
const CACHE_TTL_MS = 300000;
const REQUEST_TIMEOUT_FAST = 5000;
const REQUEST_TIMEOUT_SLOW = 15000;
const IS_PROD = process.env.NODE_ENV === 'production';
const RAILWAY_LIGHT_MODE = (process.env.RAILWAY_LIGHT_MODE || (IS_PROD ? 'true' : 'false')) === 'true';
const ALLOWED_ORIGINS = (() => {
    const raw = process.env.ALLOWED_ORIGIN || process.env.ALLOWED_ORIGINS || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
})();
const BG_CYCLE_MS = Math.max(30_000, Number(process.env.BG_CYCLE_MS || 30_000));
const BG_STAGGER_MS = Math.max(0, Number(process.env.BG_STAGGER_MS || (RAILWAY_LIGHT_MODE ? 2500 : 800)));
const PUNISHMENTS_REQ_TIMEOUT_MS = Math.max(1500, Number(process.env.PUNISHMENTS_REQ_TIMEOUT_MS || 4500));
const MAX_REQUEST_BODY_BYTES = 1024 * 1024; // 1 MB

module.exports = {
    path,
    PORT,
    API_URL,
    STEAM_API_KEY,
    FEAR_ACCESS_TOKEN,
    FACEIT_API_KEY,
    CSSTATS_COOKIE,
    DXDCS_COOKIE,
    DISCORD_BOT_TOKEN,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_REDIRECT_URI,
    DISCORD_GUILD_ID,
    DISCORD_DEFAULT_LEVEL,
    DISCORD_ROLE_LEVELS,
    DISCORD_FORCE_LEVEL_5_IDS,
    DISCORD_BLOCKED_ROLE_IDS,
    DISCORD_STATE_SECRET,
    PUNISHMENTS_ADMIN_STEAM_ID,
    FEAR_PUNISHMENTS_ADMIN_IDS,
    FEAR_PUNISHMENTS_REFRESH_HOURS,
    FEAR_PUNISHMENTS_REFRESH_MS,
    MODERATOR_API_TOKEN,
    LAUNCHER_API_KEY,
    LAUNCHER_API_TOKEN,
    USER_LEVEL_WHITELIST,
    USER_LEVEL_ADMIN,
    USER_LEVEL_SUPER,
    CACHE_TTL_MS,
    REQUEST_TIMEOUT_FAST,
    REQUEST_TIMEOUT_SLOW,
    IS_PROD,
    RAILWAY_LIGHT_MODE,
    ALLOWED_ORIGINS,
    BG_CYCLE_MS,
    BG_STAGGER_MS,
    PUNISHMENTS_REQ_TIMEOUT_MS,
    MAX_REQUEST_BODY_BYTES
};

