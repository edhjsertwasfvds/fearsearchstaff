const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.fearproject.ru/servers';
const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const FEAR_ACCESS_TOKEN = process.env.FEAR_ACCESS_TOKEN || '';
const FACEIT_API_KEY = process.env.FACEIT_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const CSSTATS_COOKIE = process.env.CSSTATS_COOKIE || '';
const DXDCS_COOKIE = process.env.DXDCS_COOKIE || '';
const PUNISHMENTS_ADMIN_STEAM_ID = process.env.PUNISHMENTS_ADMIN_STEAM_ID || '';
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
const BG_CYCLE_MS = Math.max(60_000, Number(process.env.BG_CYCLE_MS || 60_000));
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
    OPENROUTER_API_KEY,
    CSSTATS_COOKIE,
    DXDCS_COOKIE,
    PUNISHMENTS_ADMIN_STEAM_ID,
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

