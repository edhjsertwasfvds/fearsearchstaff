const path = require('path');
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
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const DISCORD_DEFAULT_LEVEL = Math.min(5, Math.max(0, Number(process.env.DISCORD_DEFAULT_LEVEL || '0')));
const DISCORD_ROLE_LEVELS = (() => {
    const raw = process.env.DISCORD_ROLE_LEVELS || '';
    if (!raw) return {};
    const map = {};
    for (const part of raw.split(',')) {
        const [roleId, levelStr] = part.split(':');
        if (!roleId || !levelStr) continue;
        const level = Math.min(5, Math.max(0, Number(levelStr.trim()) || 0));
        if (level > 0) map[roleId.trim()] = level;
    }
    return map;
})();
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
    BG_CYCLE_MS,
    BG_STAGGER_MS,
    PUNISHMENTS_REQ_TIMEOUT_MS,
    MAX_REQUEST_BODY_BYTES
};

