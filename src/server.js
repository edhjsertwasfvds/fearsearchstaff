const {
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
} = require('./config');

let activeReportsApi;
try {
    activeReportsApi = require(path.join(__dirname, '..', 'OverlayForCs2', 'activeReportsApi.js'));
} catch (e) {
    console.warn('[activeReportsApi] Overlay module not found, using server fallback:', e.message);
    const REPORT_FLAG = {
        NONE: 0,
        AIMBOT: 1 << 0,
        VISUALS: 1 << 1,
        TRIGGER: 1 << 2,
        MOVEMENT: 1 << 3,
        GRIEFING: 1 << 4,
        TOXIC: 1 << 5,
        MULTIACCOUNT: 1 << 6,
        OTHER: 1 << 7
    };
    const RULES = [
        { id: 'aimbot', flag: REPORT_FLAG.AIMBOT, labelRu: 'Аим / RCS', re: [/aim/i, /аим/i, /aimbot/i, /rage/i] },
        { id: 'visuals', flag: REPORT_FLAG.VISUALS, labelRu: 'WH / ESP', re: [/wall/i, /\bwh\b/i, /esp/i, /вх/i, /visual/i] },
        { id: 'trigger', flag: REPORT_FLAG.TRIGGER, labelRu: 'Триггер', re: [/trigger/i, /триггер/i] },
        { id: 'movement', flag: REPORT_FLAG.MOVEMENT, labelRu: 'Движение', re: [/bhop/i, /strafe/i, /speed/i, /движ/i] },
        { id: 'griefing', flag: REPORT_FLAG.GRIEFING, labelRu: 'Гриф', re: [/grief/i, /гриф/i, /blocking/i, /саботаж/i] },
        { id: 'toxic', flag: REPORT_FLAG.TOXIC, labelRu: 'Токсик', re: [/toxic/i, /токсик/i, /voice/i, /голос/i, /abuse/i] },
        { id: 'multiaccount', flag: REPORT_FLAG.MULTIACCOUNT, labelRu: 'Мультиакк', re: [/multi/i, /мульти/i, /alt/i, /смурф/i, /smurf/i] }
    ];
    const emptyPayload = () => ({
        schemaVersion: 1,
        flags: REPORT_FLAG,
        typeCatalog: RULES.map(({ id, flag, labelRu }) => ({ id, flag, labelRu })),
        summary: { activeReportRows: 0, uniqueSuspects: 0 },
        bySteamId: {},
        active: []
    });
    const isActiveReport = (r) => !(r == null || typeof r !== 'object' || r.result != null || r.status === 'closed' || r.status === 'resolved' || r.closed === true);
    const steamIdFrom = (r) => String(r?.intruder_steamid ?? r?.intruderSteamId ?? r?.target_steamid ?? r?.steam_id ?? r?.steamId ?? '').trim();
    const typeStrFrom = (r) => [r?.type, r?.report_type, r?.reason, r?.category, r?.title, Array.isArray(r?.tags) ? r.tags.join(' ') : r?.tags, r?.description, r?.comment].filter(Boolean).map(String).join(' ');
    const matchFlags = (s) => {
        let bits = REPORT_FLAG.NONE;
        const ids = [];
        const labels = [];
        for (const rule of RULES) {
            if (rule.re.some((re) => re.test(s))) {
                bits |= rule.flag;
                if (!ids.includes(rule.id)) ids.push(rule.id);
                if (!labels.includes(rule.labelRu)) labels.push(rule.labelRu);
            }
        }
        if (bits === REPORT_FLAG.NONE && String(s || '').trim()) {
            bits = REPORT_FLAG.OTHER;
            ids.push('other');
            labels.push('Прочее');
        }
        return { bits, ids, labels };
    };
    const buildPublicPayload = (rawArray) => {
        const out = emptyPayload();
        const list = Array.isArray(rawArray) ? rawArray : [];
        const activeRows = list.filter(isActiveReport);
        out.summary.activeReportRows = activeRows.length;
        const bySteamId = Object.create(null);
        for (const r of activeRows) {
            const steamId = steamIdFrom(r);
            if (!steamId) continue;
            const typeRaw = typeStrFrom(r);
            const m = matchFlags(typeRaw);
            let agg = bySteamId[steamId];
            if (!agg) {
                agg = { steamId, activeReportCount: 0, flagBits: REPORT_FLAG.NONE, typeIds: [], labels: [], sampleTypeRaw: '' };
                bySteamId[steamId] = agg;
            }
            agg.activeReportCount += 1;
            agg.flagBits |= m.bits;
            for (const t of m.ids) if (!agg.typeIds.includes(t)) agg.typeIds.push(t);
            for (const l of m.labels) if (!agg.labels.includes(l)) agg.labels.push(l);
            if (!agg.sampleTypeRaw && typeRaw) agg.sampleTypeRaw = typeRaw.slice(0, 240);
            out.active.push({
                id: r?.id ?? null,
                steamId,
                active: true,
                typeRaw: typeRaw.slice(0, 240),
                flagBits: m.bits,
                typeIds: m.ids,
                labels: m.labels,
                serverId: r?.server_id ?? r?.serverId ?? null,
                createdAt: r?.created_at ?? r?.createdAt ?? null
            });
        }
        out.bySteamId = bySteamId;
        out.summary.uniqueSuspects = Object.keys(bySteamId).length;
        return out;
    };
    activeReportsApi = { REPORT_FLAG, emptyPayload, buildPublicPayload };
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const WebSocket = require('ws');
const db = require('./database');
const auth = require('./auth');
const {
    getSessionFromReq,
    sendJson,
    sendError,
    requireSession,
    getAllowedMethodsForApiPath,
    getClientIp
} = require('./http/helpers');
const punishmentsService = require('./services/punishments');
const staffStatsService = require('./services/staffStats');
const moderatorPlayersSnapshot = require('./services/moderatorPlayersSnapshot');
const { attachWss } = require('./ws');

const FEAR_API_HOST = 'api.fearproject.ru';
const FEAR_ADMINS_LIST_PATH = '/admins/';
const FEAR_ADMINS_EDIT_PATH = '/admins/edit';

function getCookieValue(cookieHeader, name) {
    if (!cookieHeader || !name) return '';
    const re = new RegExp('(?:^|;\\s*)' + String(name).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '=([^;]+)', 'i');
    const m = String(cookieHeader).match(re);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function getRequestOrigin(req) {
    const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = xfProto || (IS_PROD ? 'https' : 'http');
    const host = String(req.headers.host || 'localhost');
    return `${proto}://${host}`;
}

function isSameOriginRequest(req) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return true; // non-browser / same-origin navigation
    return origin === getRequestOrigin(req);
}

function csrfCookieOptions() {
    const secure = IS_PROD ? 'Secure; ' : '';
    return `Path=/; SameSite=Lax; ${secure}`;
}

function setCsrfCookie(res, token) {
    const maxAge = 60 * 60; // 1 hour
    const cookie = `XSRF-TOKEN=${encodeURIComponent(String(token || ''))}; ${csrfCookieOptions()}Max-Age=${maxAge}`;
    res.setHeader('Set-Cookie', cookie);
}

function checkCsrf(req, res) {
    const headerToken = String(req.headers['x-csrf-token'] || '').trim();
    const cookieToken = String(getCookieValue(req.headers.cookie || '', 'XSRF-TOKEN') || '').trim();
    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
        sendError(res, 403, 'CSRF', 'CSRF token missing or invalid');
        return false;
    }
    if (!isSameOriginRequest(req)) {
        sendError(res, 403, 'CSRF_ORIGIN', 'Origin mismatch');
        return false;
    }
    return true;
}

function fearAdminsRequest(pathname, method, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = https.request({
            protocol: 'https:',
            hostname: FEAR_API_HOST,
            path: pathname,
            method,
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
                Origin: 'https://fearproject.ru',
                Referer: 'https://fearproject.ru/',
                'User-Agent': 'FearPanel/1.0',
                ...headers,
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        }, (resp) => {
            let raw = '';
            resp.on('data', (chunk) => { raw += chunk; });
            resp.on('end', () => {
                let json = null;
                try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
                resolve({ statusCode: resp.statusCode || 500, bodyText: raw, bodyJson: json });
            });
        });
        req.on('error', reject);
        req.setTimeout(25000, () => req.destroy(new Error('Fear API timeout')));
        if (payload) req.write(payload);
        req.end();
    });
}

// База данных инициализируется асинхронно перед запуском сервера (см. startServer)

if (!STEAM_API_KEY) {
    console.warn('⚠️ STEAM_API_KEY не найден: проверки VAC/игр/CS2 будут отключены');
}
if (!FACEIT_API_KEY) {
    console.warn('⚠️ FACEIT_API_KEY не найден: Faceit уровень не будет отображаться');
}
if (!CSSTATS_COOKIE) {
    console.warn('⚠️ CSSTATS_COOKIE не найден: CS2 Stats может показывать неполные данные');
}

console.log('✅ Сервер инициализирован');

// Кэш для оптимизации
const cache = {
    players: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    vacBans: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    yoomaBans: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    suspiciousBans: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    cs2redBans: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    deti00Bans: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    pridecs2Bans: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    top2Bans: { data: null, timestamp: 0, ttl: CACHE_TTL_MS },
    playerGames: new Map(),
    accountAge: new Map(),
    faceitLevels: new Map()
};
const runtimeMetrics = {
    api: new Map(), // key -> { count, totalMs, maxMs }
    jobs: new Map() // key -> { count, totalMs, maxMs }
};
const {
    PUNISHMENTS_CACHE_TTL_MS,
    fetchPunishmentsForSteamId,
    getPunishmentsFromCache,
    getPunishmentsCacheEntry,
    setPunishmentsToCache
} = punishmentsService;
const backgroundState = {
    cycleRunning: false,
    cycleStartedAt: 0,
    cycleNo: 0
};

// Кэш стаффа и его статистики наказаний.
// - список стаффа обновляем раз в 24 часа
// - статистику наказаний по стаффу обновляем раз в час
const {
    staffPunishmentsCache,
    STAFF_LIST_REFRESH_INTERVAL_MS,
    STAFF_STATS_REFRESH_INTERVAL_MS,
    refreshStaffList,
    refreshStaffPunishmentsCache,
    isSteamIdStaff
} = staffStatsService;

// Кэш проверенных игроков (чтобы не проверять повторно 30 минут)
const checkedPlayers = {
    vac: new Map(), // steamId -> timestamp
    yooma: new Map(),
    suspicious: new Map(),
    cs2red: new Map(),
    deti00: new Map(),
    pridecs2: new Map(),
    top2: new Map(),
    accountAge: new Map(),
    faceit: new Map()
};
const CHECK_CACHE_TTL = 30 * 60 * 1000;

// Кэш для /api/steam-avatar/: чтобы не дергать Steam API при каждом открытии страницы.
const steamAvatarCache = new Map(); // steamId -> { avatar, ts }
const STEAM_AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов
const STEAM_AVATAR_CACHE_NEGATIVE_TTL_MS = 5 * 60 * 1000; // при ошибках — короче

// Флаги для отслеживания текущих проверок
const ongoingChecks = {
    yooma: false,
    vac: false,
    suspicious: false
};

// Rate limiting
const rateLimits = new Map();
const loginRateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 30;
const LOGIN_RATE_LIMIT_WINDOW = 5 * 60000;
const MAX_LOGIN_ATTEMPTS = 5;

function checkRateLimit(ip) {
    const now = Date.now();
    const userLimit = rateLimits.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    if (now > userLimit.resetTime) {
        userLimit.count = 0;
        userLimit.resetTime = now + RATE_LIMIT_WINDOW;
    }
    userLimit.count++;
    rateLimits.set(ip, userLimit);
    return userLimit.count <= MAX_REQUESTS_PER_WINDOW;
}

function checkLoginRateLimit(ip) {
    const now = Date.now();
    const limit = loginRateLimits.get(ip) || { count: 0, resetTime: now + LOGIN_RATE_LIMIT_WINDOW };
    if (now > limit.resetTime) {
        limit.count = 0;
        limit.resetTime = now + LOGIN_RATE_LIMIT_WINDOW;
    }
    limit.count++;
    loginRateLimits.set(ip, limit);
    return limit.count <= MAX_LOGIN_ATTEMPTS;
}

function truncateForLog(value, max = 180) {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!s) return '-';
    return s.length > max ? `${s.slice(0, max)}...` : s;
}

function sessionLogChunk(session) {
    if (!session) return 'user=guest';
    return `userId=${session.userId} username=${truncateForLog(session.username, 64)} displayName=${truncateForLog(session.displayName, 64)} level=${session.level}`;
}

function logHttpRequest(req, clientIp) {
    const session = getSessionFromReq(req);
    const ua = truncateForLog(req.headers['user-agent'] || '-', 220);
    const origin = truncateForLog(req.headers.origin || '-', 140);
    const referer = truncateForLog(req.headers.referer || '-', 180);
    console.log(
        `[HTTP] method=${req.method} url=${truncateForLog(req.url, 240)} ip=${truncateForLog(clientIp, 80)} origin=${origin} referer=${referer} ua="${ua}" ${sessionLogChunk(session)}`
    );
}

// Возвращаем данные из кэша. После истечения TTL (5 мин) ещё до 15 мин отдаём «устаревшие» данные,
// чтобы счётчики и списки не обнулялись до завершения следующего фонового обновления.
const CACHE_MAX_STALE_MS = 15 * 60 * 1000; // 15 минут — дольше не показываем старые данные

function getCachedData(cacheKey) {
    const cached = cache[cacheKey];
    if (!cached || !cached.data) return null;
    const age = Date.now() - cached.timestamp;
    if (age < cached.ttl) return cached.data;        // свежие
    if (age < CACHE_MAX_STALE_MS) return cached.data; // устаревшие, но показываем пока не обновится
    return null;
}

function setCachedData(cacheKey, data) {
    cache[cacheKey].data = data;
    cache[cacheKey].timestamp = Date.now();
}

function nowMs() {
    return Date.now();
}

function trackMetric(map, key, durationMs) {
    const prev = map.get(key) || { count: 0, totalMs: 0, maxMs: 0 };
    prev.count += 1;
    prev.totalMs += durationMs;
    if (durationMs > prev.maxMs) prev.maxMs = durationMs;
    map.set(key, prev);
}

function timedJob(name, fn) {
    const started = nowMs();
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            return r.finally(() => trackMetric(runtimeMetrics.jobs, name, nowMs() - started));
        }
        trackMetric(runtimeMetrics.jobs, name, nowMs() - started);
        return r;
    } catch (e) {
        trackMetric(runtimeMetrics.jobs, name, nowMs() - started);
        throw e;
    }
}

function parseServersPayload(rawPayload) {
    const parsed = JSON.parse(rawPayload);
    if (!Array.isArray(parsed)) {
        // Иногда API может вернуть обертку, извлекаем массив серверов из известных ключей
        if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.servers)) return parsed.servers;
            if (Array.isArray(parsed.data)) return parsed.data;
            if (Array.isArray(parsed.results)) return parsed.results;

            const values = Object.values(parsed);
            if (values.length > 0 && values.every(item => item && typeof item === 'object' && ('id' in item || 'live_data' in item))) {
                return values;
            }
        }

        const preview = String(rawPayload).slice(0, 180).replace(/\s+/g, ' ');
        throw new Error(`Fear API response has unexpected format: ${preview}`);
    }
    return parsed;
}

function getServerDisplayName(server) {
    return server.site_name || server.domain || server.type || `Server ${server.id || 'unknown'}`;
}

function buildOnlinePlayersContext(servers) {
    const steamIds = new Set();
    const playerDataMap = new Map();
    let totalPlayers = 0;
    let totalAdmins = 0;

    if (!Array.isArray(servers)) {
        return { steamIds, playerDataMap, totalPlayers, totalAdmins };
    }

    servers.forEach(server => {
        const modeName = String(server?.mode?.name || '');
        const modeId = Number(server?.mode?.id);
        const serverGame = (modeId === 5 || /cs:go/i.test(modeName)) ? 'CSGO' : 'CS2';
        const players = server?.live_data?.players;
        if (!Array.isArray(players)) return;

        totalPlayers += players.length;
        totalAdmins += players.filter(player => Boolean(player?.is_admin)).length;

        players.forEach(player => {
            const steamId = player?.steam_id ? String(player.steam_id) : null;
            if (!steamId) return;

            steamIds.add(steamId);

            if (!playerDataMap.has(steamId)) {
                const pingRaw = player?.ping;
                const pingVal = pingRaw != null && pingRaw !== '' ? Number(pingRaw) : null;
                playerDataMap.set(steamId, {
                    nickname: player.nickname || 'Unknown',
                    avatar: player.avatar || 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg',
                    kills: Number(player.kills) || 0,
                    deaths: Number(player.deaths) || 0,
                    serverName: getServerDisplayName(server),
                    serverGame,
                    serverIp: server?.ip || null,
                    serverPort: Number(server?.port) || null,
                    isAdmin: Boolean(player?.is_admin),
                    ping: Number.isFinite(pingVal) ? pingVal : null
                });
            }
        });
    });

    return { steamIds, playerDataMap, totalPlayers, totalAdmins };
}

function fetchFearServers(callback) {
    https.get(API_URL, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
            try {
                const servers = parseServersPayload(data);
                callback(null, servers);
            } catch (error) {
                callback(error);
            }
        });
    }).on('error', callback);
}

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
};

function isTextLikeContentType(contentType) {
    const ct = String(contentType || '').toLowerCase();
    return ct.startsWith('text/') || ct.includes('javascript') || ct.includes('json') || ct.includes('svg+xml');
}

function wantsGzip(req) {
    const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
    return ae.includes('gzip');
}

function getSessionTokenFromCookie(cookieHeader) {
    if (!cookieHeader) return '';
    const m = String(cookieHeader).match(/(?:^|;\s*)sessionToken=([^;]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
}

// Функция для проверки банов на Yooma через WebSocket (быстрая параллельная проверка)
function checkYoomaBans(steamIds, playerDataMap, progressCallback, finalCallback) {
    try {
        const WebSocket = require('ws');
        const bannedPlayers = [];
        const NUM_WORKERS = 8; // Увеличено до 8 параллельных соединений
        
        // Делим игроков на части для каждого воркера
        const chunkSize = Math.ceil(steamIds.length / NUM_WORKERS);
        const chunks = [];
        for (let i = 0; i < steamIds.length; i += chunkSize) {
            chunks.push(steamIds.slice(i, i + chunkSize));
        }
        
        const actualWorkerCount = Math.min(NUM_WORKERS, chunks.length);
        console.log(`[Yooma] Начинаем проверку ${steamIds.length} игроков через ${actualWorkerCount} соединений`);
        let completedWorkers = 0;
        let totalProcessed = 0;
        
        // Функция для проверки одного игрока через WebSocket
        async function checkOnePlayer(ws, steamId) {
            return new Promise((resolve) => {
                let timeoutId = null;
                let messageHandler = null;
                
                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (messageHandler) ws.removeListener('message', messageHandler);
                };
                
                timeoutId = setTimeout(() => {
                    cleanup();
                    resolve(null);
                }, 10000); // Уменьшено до 10 секунд
                
                messageHandler = (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        
                        // Проверяем профиль
                        if (msg.type === 'get_profile' && msg.profile) {
                            const profile = msg.profile;
                            if (String(profile.steam_id) === String(steamId)) {
                                if (profile.ban && profile.ban.expires) {
                                    const expires = parseInt(profile.ban.expires);
                                    const isBanned = expires > 0;
                                    
                                    if (!isBanned) {
                                        cleanup();
                                        resolve(null);
                                        return;
                                    }
                                    
                                    // Забанен - запрашиваем детали
                                    ws.send(JSON.stringify({
                                        type: "get_punishments",
                                        page: 1,
                                        punish_type: 0,
                                        search: steamId,
                                        mobile: false
                                    }));
                                } else {
                                    cleanup();
                                    resolve(null);
                                }
                            }
                        }
                        
                        // Получаем детали бана
                        if (msg.type === 'get_punishments' && msg.punishments && msg.punishments.length > 0) {
                            const punishment = msg.punishments.find(p => String(p.steamid) === String(steamId));
                            
                            if (punishment) {
                                // Проверяем активность бана
                                if (punishment.unpunish_admin_id !== null && punishment.unpunish_admin_id !== undefined) {
                                    cleanup();
                                    resolve(null);
                                    return;
                                }
                                
                                const currentTime = Math.floor(Date.now() / 1000);
                                const isActive = punishment.expires === 0 || punishment.expires > currentTime;
                                
                                if (isActive) {
                                    const playerInfo = playerDataMap.get(steamId);
                                    const banDetails = {
                                        steamId: steamId,
                                        nickname: playerInfo ? playerInfo.nickname : punishment.name,
                                        avatar: playerInfo ? playerInfo.avatar : `https://avatars.akamai.steamstatic.com/${punishment.player_avatar}_medium.jpg`,
                                        reason: punishment.reason,
                                        created: punishment.created,
                                        expires: punishment.expires,
                                        adminName: punishment.admin_name,
                                        isPermanent: punishment.expires === 0
                                    };
                                    cleanup();
                                    resolve(banDetails);
                                    return;
                                }
                                
                                cleanup();
                                resolve(null);
                            }
                        }
                    } catch (err) {
                        console.error(`[Yooma] Ошибка парсинга для ${steamId}:`, err.message);
                    }
                };
                
                ws.on('message', messageHandler);
                
                // Отправляем запрос профиля
                try {
                    ws.send(JSON.stringify({
                        type: "get_profile",
                        steamid: steamId
                    }));
                } catch (err) {
                    console.error(`[Yooma] Ошибка отправки для ${steamId}:`, err.message);
                    cleanup();
                    resolve(null);
                }
            });
        }
        
        // Воркер - обрабатывает свою часть игроков
        async function worker(workerId, playerChunk) {
            console.log(`[Yooma] Воркер ${workerId} запущен, игроков: ${playerChunk.length}`);
            
            const workerBans = [];
            let ws = null;
            let processed = 0;
            
            try {
                ws = new WebSocket('wss://yooma.su/api');
                ws.setMaxListeners(50); // Увеличиваем лимит слушателей
                
                await new Promise((resolve, reject) => {
                    ws.on('open', resolve);
                    ws.on('error', reject);
                    setTimeout(() => reject(new Error('Connection timeout')), 5000);
                });
                
                console.log(`[Yooma] Воркер ${workerId} подключен`);
                
                // Обрабатываем всех игроков в этом чанке
                for (let i = 0; i < playerChunk.length; i++) {
                    const steamId = playerChunk[i];
                    
                    try {
                        const result = await checkOnePlayer(ws, steamId);
                        
                        if (result) {
                            workerBans.push(result);
                            bannedPlayers.push(result);
                        }
                        
                        processed++;
                        totalProcessed++;
                        
                        if (processed % 10 === 0 || i === playerChunk.length - 1) {
                            console.log(`[Yooma] Воркер ${workerId}: ${processed}/${playerChunk.length}, банов: ${workerBans.length}`);
                        }
                    } catch (err) {
                        console.error(`[Yooma] Ошибка проверки ${steamId}:`, err.message);
                        processed++;
                        totalProcessed++;
                    }
                    
                    // Минимальная задержка между запросами
                    await new Promise(resolve => setTimeout(resolve, 50)); // Уменьшено до 50мс
                }
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
                
            } catch (err) {
                console.error(`[Yooma] Воркер ${workerId} ошибка:`, err.message);
                if (ws) {
                    try {
                        ws.close();
                    } catch (e) {}
                }
            }
            
            completedWorkers++;
            console.log(`[Yooma] Воркер ${workerId} завершен. Найдено банов: ${workerBans.length}`);
            
            // Сортируем текущие результаты
            const sortedBans = [...bannedPlayers].sort((a, b) => {
                const timeA = a.created || 0;
                const timeB = b.created || 0;
                return timeB - timeA;
            });
            
            // Отправляем прогресс после завершения воркера
            if (progressCallback) {
                progressCallback({
                    processed: totalProcessed,
                    total: steamIds.length,
                    found: sortedBans.length,
                    players: sortedBans
                });
            }
            
            // Если все воркеры завершены - финальный callback
            if (completedWorkers === actualWorkerCount) {
                console.log(`[Yooma] ✓ ВСЕ ВОРКЕРЫ ЗАВЕРШЕНЫ! Найдено банов: ${sortedBans.length}`);
                if (finalCallback) {
                    finalCallback(null, sortedBans);
                }
            }
        }
        
        // Запускаем воркеры параллельно
        for (let i = 0; i < actualWorkerCount; i++) {
            worker(i + 1, chunks[i]).catch(err => {
                console.error(`[Yooma] Критическая ошибка воркера ${i + 1}:`, err);
                completedWorkers++;
                if (completedWorkers === actualWorkerCount && finalCallback) {
                    const sortedBans = [...bannedPlayers].sort((a, b) => {
                        const timeA = a.created || 0;
                        const timeB = b.created || 0;
                        return timeB - timeA;
                    });
                    finalCallback(null, sortedBans);
                }
            });
        }
        
    } catch (err) {
        console.error('[Yooma] Критическая ошибка:', err.message);
        if (finalCallback) {
            finalCallback(null, []);
        }
    }
}

// Функция для проверки опасных игроков через dxdcs.ru
async function checkSuspiciousBans(steamIds, playerDataMap, progressCallback, finalCallback) {
    if (!DXDCS_COOKIE) {
        console.log('[Suspicious] DXDCS_COOKIE не задан, проверка dxdcs.ru отключена');
        finalCallback(null, []);
        return;
    }
    console.log(`[Suspicious] Проверка ${steamIds.length} игроков на dxdcs.ru`);
    
    const suspiciousPlayers = [];
    
    // Функция для проверки одного игрока
    const checkPlayer = (steamId) => {
        return new Promise((resolve) => {
            const postData = `search_ban=${steamId}&search_mute=&search_admin=`;
            
            const options = {
                hostname: 'dxdcs.ru',
                port: 443,
                path: '/punishment/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': postData.length,
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Cookie': DXDCS_COOKIE,
                    'Referer': 'https://dxdcs.ru/punishment/',
                    'Origin': 'https://dxdcs.ru',
                    'Host': 'dxdcs.ru'
                }
            };
            
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        
                        if (result.html && result.html.length > 0) {
                            const htmlData = result.html[0];
                            
                            if (htmlData.search_html && htmlData.search_html.includes('permanent_punish')) {
                                const playerInfo = playerDataMap.get(steamId);
                                const html = htmlData.search_html;
                                
                                // Парсим span элементы
                                const spanRegex = /<span>([^<]+)<\/span>/g;
                                const spans = [...html.matchAll(spanRegex)];
                                
                                let playerName = 'Unknown';
                                let reason = 'Перманентный бан';
                                let adminName = 'Unknown';
                                
                                if (spans.length >= 2) {
                                    playerName = spans[0][1];
                                    reason = spans[1][1].trim();
                                    if (/RAC/i.test(reason) || reason.includes('[i:')) reason = 'AC';
                                    else if (/AntiDLL/i.test(reason)) reason = 'AC';
                                    else if (/Haron Anti-Cheat/i.test(reason)) reason = 'AC';
                                }
                                
                                // Ищем админа
                                const adminMatch = html.match(/<span class="none_span">([^<]+)<\/span>\s*<\/li>/);
                                if (adminMatch) {
                                    adminName = adminMatch[1];
                                }
                                
                                suspiciousPlayers.push({
                                    steamId: steamId,
                                    nickname: playerInfo ? playerInfo.nickname : playerName,
                                    avatar: playerInfo ? playerInfo.avatar : `https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg`,
                                    reason: reason,
                                    adminName: adminName,
                                    isPermanent: true,
                                    source: 'dxdcs.ru'
                                });
                                
                                console.log(`[Suspicious] ✓ Найден: ${playerInfo ? playerInfo.nickname : playerName} - ${reason}`);
                            }
                        }
                        resolve();
                    } catch (err) {
                        console.error(`[Suspicious] Ошибка парсинга для ${steamId}:`, err.message);
                        resolve();
                    }
                });
            });
            
            req.on('error', (err) => {
                console.error(`[Suspicious] Ошибка запроса для ${steamId}:`, err.message);
                resolve();
            });
            
            req.write(postData);
            req.end();
        });
    };
    
    // Проверяем игроков параллельно (батчами по 10)
    const batchSize = 10;
    for (let i = 0; i < steamIds.length; i += batchSize) {
        const batch = steamIds.slice(i, i + batchSize);
        
        await Promise.all(batch.map(steamId => checkPlayer(steamId)));
        
        // Отправляем прогресс после каждого батча
        if (progressCallback) {
            progressCallback({
                processed: Math.min(i + batchSize, steamIds.length),
                total: steamIds.length,
                found: suspiciousPlayers.length,
                players: [...suspiciousPlayers]
            });
        }
        
        console.log(`[Suspicious] Прогресс: ${Math.min(i + batchSize, steamIds.length)}/${steamIds.length}, найдено: ${suspiciousPlayers.length}`);
        
        // Небольшая задержка между батчами
        if (i + batchSize < steamIds.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    console.log(`[Suspicious] ✓ Проверка завершена. Найдено: ${suspiciousPlayers.length}`);
    finalCallback(null, suspiciousPlayers);
}

async function checkCS2RedBans(steamIds, playerDataMap) {
    console.log(`[CS2Red] Проверка ${steamIds.length} игроков`);
    const bannedPlayers = [];
    const batchSize = 5;
    for (let i = 0; i < steamIds.length; i += batchSize) {
        const batch = steamIds.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map(sid => {
            return new Promise((resolve) => {
                const url = `https://cs2red.ru/api/profile?steamid=${sid}`;
                const req = https.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'application/json, text/plain, */*',
                        'Referer': 'https://cs2red.ru/',
                        'Origin': 'https://cs2red.ru'
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            if (!json.success || !json.user) return resolve(null);
                            const u = json.user;
                            const activeBans = (u.bans || []).filter(b => {
                                if (b.unbanId) return false;
                                const now = Math.floor(Date.now() / 1000);
                                const endTs = Number(b.endTimeStamp);
                                return endTs === 0 || (Number.isFinite(endTs) && endTs > now);
                            });
                            if (activeBans.length === 0) return resolve(null);
                            resolve({ steamId: sid, bans: activeBans });
                        } catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(10000, () => { req.destroy(); resolve(null); });
            });
        }));
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                const { steamId, bans } = r.value;
                const playerData = playerDataMap.get(steamId);
                const reason = bans.map(b => b.reason || 'CS2Red').join(', ');
                bannedPlayers.push({
                    steamId,
                    nickname: playerData?.nickname || 'Unknown',
                    avatar: playerData?.avatar || 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg',
                    reason,
                    bans
                });
            }
        }
        if (i + batchSize < steamIds.length) await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[CS2Red] ✓ Проверка завершена. Найдено: ${bannedPlayers.length}`);
    return bannedPlayers;
}

async function checkDeti00Bans(steamIds, playerDataMap) {
    console.log(`[Deti00] Проверка ${steamIds.length} игроков на deti00ykh.ru`);
    const bannedPlayers = [];
    const batchSize = 3;
    const strip = s => s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

    for (let i = 0; i < steamIds.length; i += batchSize) {
        const batch = steamIds.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map(sid => {
            return new Promise((resolve) => {
                const url = `https://deti00ykh.ru/profiles/${sid}/block/12/`;
                const req = https.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'identity',
                        'Referer': `https://deti00ykh.ru/profiles/${sid}/?search=1`
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            if (res.statusCode !== 200 || data.length < 1000) return resolve(null);
                            const isBanned = /badge_banned/.test(data);
                            if (!isBanned) return resolve(null);

                            const nickname = strip(data.match(/<div class="user_nickname">\s*([\s\S]*?)\s*<\/div>/)?.[1] || '');
                            const avatar = data.match(/id="avatar"[^>]*src="([^"]+)"/)?.[1] || '';

                            const bans = [];
                            const bansSection = data.match(/Последние баны[\s\S]*?bans_comms_content[\s\S]*?<\/ul>/);
                            if (bansSection) {
                                const rows = bansSection[0].match(/<li>[\s\S]*?<\/li>/g) || [];
                                for (const row of rows) {
                                    const spans = [...row.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m => strip(m[1]));
                                    if (spans.length >= 5 && /\d{2}\.\d{2}\.\d{4}/.test(spans[0])) {
                                        bans.push({ date: spans[0], reason: spans[1], admin: spans[2], duration: spans[3], expires: spans[4] });
                                    }
                                }
                            }

                            if (bans.length === 0) return resolve(null);

                            const latestBan = bans[0];
                            const playerData = playerDataMap.get(sid);
                            resolve({
                                steamId: sid,
                                nickname: playerData?.nickname || nickname || 'Unknown',
                                avatar: playerData?.avatar || (avatar.startsWith('http') ? avatar : avatar ? `https://deti00ykh.ru${avatar}` : ''),
                                reason: latestBan.reason || 'Deti00',
                                admin: latestBan.admin,
                                duration: latestBan.duration,
                                expires: latestBan.expires,
                                date: latestBan.date,
                                bans
                            });
                        } catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(15000, () => { req.destroy(); resolve(null); });
            });
        }));
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                bannedPlayers.push(r.value);
            }
        }
        if (i + batchSize < steamIds.length) await new Promise(r => setTimeout(r, 800));
    }
    console.log(`[Deti00] ✓ Проверка завершена. Найдено: ${bannedPlayers.length}`);
    return bannedPlayers;
}

async function checkPrideCS2Bans(steamIds, playerDataMap) {
    console.log(`[PrideCS2] Проверка ${steamIds.length} игроков на pridecs2.ru`);
    const bannedPlayers = [];
    const batchSize = 3;
    const strip = s => s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

    for (let i = 0; i < steamIds.length; i += batchSize) {
        const batch = steamIds.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map(sid => {
            return new Promise((resolve) => {
                const url = `https://pridecs2.ru/profiles/${sid}/block/0/`;
                const req = https.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'identity',
                        'Referer': `https://pridecs2.ru/profiles/${sid}/?search=1`
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            if (res.statusCode !== 200 || data.length < 1000) return resolve(null);
                            const isBanned = /badge_banned/.test(data);
                            if (!isBanned) return resolve(null);

                            const nickname = strip(data.match(/<div class="user_nickname">\s*([\s\S]*?)\s*<\/div>/)?.[1] || '');
                            const avatar = data.match(/id="avatar"[^>]*src="([^"]+)"/)?.[1] || '';

                            const bans = [];
                            const bansSection = data.match(/Последние баны[\s\S]*?bans_comms_content[\s\S]*?<\/ul>/);
                            if (bansSection) {
                                const rows = bansSection[0].match(/<li>[\s\S]*?<\/li>/g) || [];
                                for (const row of rows) {
                                    const spans = [...row.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m => strip(m[1]));
                                    if (spans.length >= 5 && /\d{2}\.\d{2}\.\d{4}/.test(spans[0])) {
                                        bans.push({ date: spans[0], reason: spans[1], admin: spans[2], duration: spans[3], expires: spans[4] });
                                    }
                                }
                            }

                            if (bans.length === 0) return resolve(null);

                            const latestBan = bans[0];
                            const playerData = playerDataMap.get(sid);
                            resolve({
                                steamId: sid,
                                nickname: playerData?.nickname || nickname || 'Unknown',
                                avatar: playerData?.avatar || (avatar.startsWith('http') ? avatar : avatar ? `https://pridecs2.ru${avatar}` : ''),
                                reason: latestBan.reason || 'PrideCS2',
                                admin: latestBan.admin,
                                duration: latestBan.duration,
                                expires: latestBan.expires,
                                date: latestBan.date,
                                bans
                            });
                        } catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(15000, () => { req.destroy(); resolve(null); });
            });
        }));
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                bannedPlayers.push(r.value);
            }
        }
        if (i + batchSize < steamIds.length) await new Promise(r => setTimeout(r, 800));
    }
    console.log(`[PrideCS2] ✓ Проверка завершена. Найдено: ${bannedPlayers.length}`);
    return bannedPlayers;
}

async function checkTop2Bans(steamIds, playerDataMap) {
    console.log(`[Top2] Проверка ${steamIds.length} игроков на top2.fun`);
    const bannedPlayers = [];
    const batchSize = 3;
    const strip = s => s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

    for (let i = 0; i < steamIds.length; i += batchSize) {
        const batch = steamIds.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map(sid => {
            return new Promise((resolve) => {
                const url = `https://top2.fun/profiles/${sid}/block/0/`;
                const req = https.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'identity',
                        'Host': 'top2.fun',
                        'Referer': `https://top2.fun/profiles/${sid}/?search=1`,
                        'Cookie': 'PHPSESSID=647e9c72684a75b3cd7ba27154d50fb0'
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            if (res.statusCode !== 200 || data.length < 1000) return resolve(null);
                            const isBanned = /badge_banned/.test(data);
                            if (!isBanned) return resolve(null);

                            const nickname = strip(data.match(/<div class="user_nickname">\s*([\s\S]*?)\s*<\/div>/)?.[1] || '');
                            const avatar = data.match(/id="avatar"[^>]*src="([^"]+)"/)?.[1] || '';

                            const bans = [];
                            const bansSection = data.match(/Последние баны[\s\S]*?bans_comms_content[\s\S]*?<\/ul>/);
                            if (bansSection) {
                                const rows = bansSection[0].match(/<li>[\s\S]*?<\/li>/g) || [];
                                for (const row of rows) {
                                    const spans = [...row.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m => strip(m[1]));
                                    if (spans.length >= 5 && /\d{2}\.\d{2}\.\d{4}/.test(spans[0])) {
                                        bans.push({ date: spans[0], reason: spans[1], admin: spans[2], duration: spans[3], expires: spans[4] });
                                    }
                                }
                            }

                            if (bans.length === 0) return resolve(null);

                            const latestBan = bans[0];
                            const playerData = playerDataMap.get(sid);
                            resolve({
                                steamId: sid,
                                nickname: playerData?.nickname || nickname || 'Unknown',
                                avatar: playerData?.avatar || (avatar.startsWith('http') ? avatar : avatar ? `https://top2.fun${avatar}` : ''),
                                reason: latestBan.reason || 'Top2',
                                admin: latestBan.admin,
                                duration: latestBan.duration,
                                expires: latestBan.expires,
                                date: latestBan.date,
                                bans
                            });
                        } catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(15000, () => { req.destroy(); resolve(null); });
            });
        }));
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                bannedPlayers.push(r.value);
            }
        }
        if (i + batchSize < steamIds.length) await new Promise(r => setTimeout(r, 800));
    }
    console.log(`[Top2] ✓ Проверка завершена. Найдено: ${bannedPlayers.length}`);
    return bannedPlayers;
}

// Функция для проверки VAC банов
function checkVACBans(steamIds, callback) {
    if (!STEAM_API_KEY) {
        callback(null, []);
        return;
    }

    const url = `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${STEAM_API_KEY}&steamids=${steamIds.join(',')}`;
    
    https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                callback(null, result.players || []);
            } catch (err) {
                callback(err, null);
            }
        });
    }).on('error', callback);
}

// Функция для получения списка игр пользователя
function getPlayerGames(steamId, callback) {
    if (!STEAM_API_KEY) {
        callback(null, []);
        return;
    }

    const ownedGamesUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&format=json`;
    const recentGamesUrl = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${STEAM_API_KEY}&steamid=${steamId}&format=json`;
    
    console.log('Запрос игр в библиотеке для:', steamId);
    
    let ownedGames = [];
    let recentGames = [];
    let completedRequests = 0;
    
    // Получаем игры в библиотеке
    https.get(ownedGamesUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                ownedGames = result.response?.games || [];
                console.log(`Игр в библиотеке: ${ownedGames.length}`);
                completedRequests++;
                if (completedRequests === 2) {
                    combineAndReturn();
                }
            } catch (err) {
                console.error('Ошибка парсинга owned games:', err);
                completedRequests++;
                if (completedRequests === 2) {
                    combineAndReturn();
                }
            }
        });
    }).on('error', (err) => {
        console.error('Ошибка запроса owned games:', err);
        completedRequests++;
        if (completedRequests === 2) {
            combineAndReturn();
        }
    });
    
    // Получаем недавно сыгранные игры
    https.get(recentGamesUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                recentGames = result.response?.games || [];
                console.log(`Недавно сыгранных игр: ${recentGames.length}`);
                completedRequests++;
                if (completedRequests === 2) {
                    combineAndReturn();
                }
            } catch (err) {
                console.error('Ошибка парсинга recent games:', err);
                completedRequests++;
                if (completedRequests === 2) {
                    combineAndReturn();
                }
            }
        });
    }).on('error', (err) => {
        console.error('Ошибка запроса recent games:', err);
        completedRequests++;
        if (completedRequests === 2) {
            combineAndReturn();
        }
    });
    
    function combineAndReturn() {
        // Объединяем игры, убирая дубликаты
        const gamesMap = new Map();
        
        ownedGames.forEach(game => {
            gamesMap.set(game.appid, game);
        });
        
        recentGames.forEach(game => {
            if (!gamesMap.has(game.appid)) {
                gamesMap.set(game.appid, game);
            }
        });
        
        const allGames = Array.from(gamesMap.values());
        console.log(`Всего уникальных игр: ${allGames.length}`);
        callback(null, allGames);
    }
}

const server = http.createServer(async (req, res) => {
    const reqStartedAt = nowMs();
    const clientIp = getClientIp(req);
    logHttpRequest(req, clientIp);
    const safeLog = (session, actionType, targetSteamId, targetName, details) => {
        try {
            if (!session) return;
            const t = String(actionType || '').trim();
            if (!t) return;
            if (t === 'view_bans') return; // never log this action
            db.logAction(String(session.userId), String(session.username || session.displayName || 'user'), t,
                targetSteamId != null ? String(targetSteamId) : null,
                targetName != null ? String(targetName) : null,
                details != null ? String(details) : null,
                clientIp || null
            );
        } catch (_) {}
    };
    
    // CORS headers
    const configuredAllowedOrigin = (process.env.ALLOWED_ORIGIN || '').trim();
    const allowAnyOrigin = !IS_PROD && !configuredAllowedOrigin;
    const allowedOrigin = configuredAllowedOrigin || (allowAnyOrigin ? '*' : '');
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const reqOrigin = req.headers.origin || '';
    const isApiRequest = parsedUrl.pathname.startsWith('/api/');
    const allowMethods = isApiRequest ? getAllowedMethodsForApiPath(parsedUrl.pathname) : 'GET, OPTIONS';
    if (isApiRequest && allowedOrigin && allowedOrigin !== '*' && reqOrigin && reqOrigin !== allowedOrigin) {
        sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed');
        return;
    }
    if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', allowMethods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-CSRF-Token');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (IS_PROD) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const contentLength = Number(req.headers['content-length'] || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
            sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
            return;
        }
    }

    if (req.method === 'OPTIONS') {
        const reqMethod = String(req.headers['access-control-request-method'] || '').toUpperCase();
        if (reqMethod && !allowMethods.split(',').map(s => s.trim()).includes(reqMethod)) {
            sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
            return;
        }
        res.writeHead(200);
        res.end();
        return;
    }

    // Rate limiting для API endpoints
    // Локальная разработка и легкий endpoint аватарок не должны упираться в 429.
    const isLocalClient = clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1';
    const isAvatarApi = req.url.startsWith('/api/steam-avatar/');
    if (isApiRequest && !isLocalClient && !isAvatarApi) {
        if (!checkRateLimit(clientIp)) {
            sendError(res, 429, 'RATE_LIMIT', 'Too many requests. Please try again later.');
            return;
        }
    }
    res.on('finish', () => {
        if (!isApiRequest) return;
        trackMetric(runtimeMetrics.api, `${req.method} ${req.url.split('?')[0]}`, nowMs() - reqStartedAt);
    });

    // CSRF token (double-submit). Only for authenticated users.
    if (parsedUrl.pathname === '/api/csrf' && req.method === 'GET') {
        const session = requireSession(req, res, 0);
        if (!session) return;
        const token = crypto.randomBytes(32).toString('hex');
        setCsrfCookie(res, token);
        sendJson(res, 200, { csrfToken: token });
        return;
    }

    // CSRF protection for state-changing API endpoints (cookie-only auth).
    // Exclusions: endpoints that must work before having a session cookie.
    const csrfExcluded = (
        parsedUrl.pathname === '/api/auth/login' ||
        parsedUrl.pathname === '/api/auth/register-by-invite' ||
        parsedUrl.pathname === '/api/auth/validate-invite' ||
        parsedUrl.pathname === '/api/auth/session' ||
        parsedUrl.pathname === '/api/public-config'
    );
    const isStateChanging = (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH');
    if (isApiRequest && isStateChanging && !csrfExcluded) {
        if (!checkCsrf(req, res)) return;
    }

    // Авторизация по логину/паролю
    if (req.url === '/api/auth/login' && req.method === 'POST') {
        if (!checkLoginRateLimit(clientIp)) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Слишком много попыток входа. Подождите 5 минут.' }));
        return;
    }

    // Публичная конфигурация страницы авторизации (без секрета)
    if (req.url === '/api/public-config' && req.method === 'GET') {
        const supportUrl = String(process.env.AUTH_SUPPORT_URL || '').trim();
        const supportLabel = String(process.env.AUTH_SUPPORT_LABEL || '').trim();
        sendJson(res, 200, {
            authSupportUrl: supportUrl || null,
            authSupportLabel: supportLabel || null
        });
        return;
    }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Введите логин и пароль' }));
            return;
        }
                const user = db.verifyUser(username, password);
                if (!user) {
                    console.log(`[Auth] Неудачная попытка входа: ${username} от ${clientIp}`);
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Неверный логин или пароль' }));
                    return;
                }
                const session = auth.createSession(user);
                console.log(`[Auth] Пользователь авторизован: ${user.username} (id=${user.id}), level=${user.level}`);
                const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
                const cookieSecure = IS_PROD ? 'Secure; ' : '';
                const cookie = `sessionToken=${encodeURIComponent(session.token)}; Path=/; SameSite=Lax; HttpOnly; ${cookieSecure}Max-Age=${maxAge}`;
                res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookie });
                res.end(JSON.stringify({
                    success: true,
                    user: { id: user.id, username: user.username, displayName: user.displayName, level: user.level, steamId: user.steamId || null },
                    sessionToken: session.token,
                    expiresAt: session.expiresAt
                }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // Управление пользователями (level >= USER_LEVEL_ADMIN — ГА)
    if (req.url === '/api/users' && req.method === 'GET') {
        const session = requireSession(req, res, USER_LEVEL_ADMIN);
        if (!session) return;
        const users = db.getAllUsers();
        sendJson(res, 200, { users });
        return;
    }

    if (req.url === '/api/users' && req.method === 'POST') {
        const session = requireSession(req, res, USER_LEVEL_ADMIN);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password, displayName, level } = JSON.parse(body);
                if (!username || !password) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Введите логин и пароль' }));
                    return;
                }
                if (username.length < 2 || username.length > 32 || !/^[a-zA-Z0-9_\-а-яА-ЯёЁ]+$/.test(username)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Логин: 2-32 символа, буквы/цифры/_/-' }));
                    return;
                }
                if (password.length < 6) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Пароль минимум 6 символов' }));
                    return;
                }
                const newLevel = Math.min(parseInt(level) || 1, Math.min(session.level, 5));
                const id = db.createUser(username, password, displayName || username, newLevel);
                console.log(`[Auth] Создан пользователь: ${username} (id=${id}), level=${newLevel} (by ${session.username})`);
                safeLog(session, 'user_create', null, String(username), `id=${id} level=${newLevel}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id }));
                } catch (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Пользователь с таким логином уже существует' }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            }
        });
        return;
    }

    if (req.url.match(/^\/api\/users\/\d+$/) && req.method === 'PUT') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        const userId = parseInt(req.url.split('/api/users/')[1]);
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const { level, password, steamId: rawSteamId } = payload;
                const target = db.getUserById(userId);
                if (!target) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Пользователь не найден' }));
                    return;
                }
                if (session.level < USER_LEVEL_SUPER && target.level >= session.level && userId !== session.userId) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Нельзя изменять пользователя с таким же или выше уровнем' }));
                    return;
                }
                if (level !== undefined) {
                    const newLevel = Math.min(Math.max(parseInt(level), 1), Math.min(session.level, 5));
                    db.updateUserLevel(userId, newLevel);
                    console.log(`[Auth] Уровень ${target.username} изменён: ${target.level} → ${newLevel} (by ${session.username})`);
                    safeLog(session, 'user_level_update', null, String(target.username), `${target.level} -> ${newLevel} (id=${userId})`);
                }
                if (password) {
                    db.updateUserPassword(userId, password);
                    console.log(`[Auth] Пароль ${target.username} изменён (by ${session.username})`);
                    safeLog(session, 'user_password_update', null, String(target.username), `id=${userId}`);
                }
                if (Object.prototype.hasOwnProperty.call(payload, 'steamId')) {
                    if (session.level < USER_LEVEL_SUPER) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Недостаточно прав для привязки SteamID (нужен уровень 5)' }));
                        return;
                    }
                    const steamIdRaw = String(rawSteamId || '').trim();
                    const steamId = steamIdRaw === '' ? null : steamIdRaw;
                    if (steamId !== null && !/^\d{5,}$/.test(steamId)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Некорректный SteamID' }));
                        return;
                    }
                    db.updateUserSteamId(userId, steamId);
                    console.log(`[Auth] SteamID ${target.username} обновлён: ${steamId || '—'} (by ${session.username})`);
                    safeLog(session, 'user_steamid_update', String(steamId || ''), String(target.username), `id=${userId}`);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
            }
        });
                        return;
                    }
                    
    if (req.url.match(/^\/api\/users\/\d+$/) && req.method === 'DELETE') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        const userId = parseInt(req.url.split('/api/users/')[1]);
        if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid user id' }));
            return;
        }
        if (userId === session.userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Нельзя удалить себя' }));
            return;
        }
        const target = db.getUserById(userId);
        if (session.level < USER_LEVEL_SUPER && target && target.level >= session.level) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Нельзя удалить пользователя с таким же или выше уровнем' }));
            return;
        }
        // Сначала инвалидируем все сессии пользователя, затем удаляем из БД.
        try { db.deleteSessionsByUserId(userId); } catch (_) {}
        db.deleteUser(userId);
        console.log(`[Auth] Удалён пользователь: ${target?.username || userId} (by ${session.username})`);
        safeLog(session, 'user_delete', null, String(target?.username || userId), `id=${userId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Сброс всех пользователей (только level 5)
    if (req.url === '/api/users/reset' && req.method === 'DELETE') {
        const session = getSessionFromReq(req);
        if (!session || session.level < 5) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав (нужен уровень 5)' }));
            return;
        }
        // Сбрасываем пользователей и их сессии, чтобы никто не оставался залогинен.
        try { db.deleteAllSessionsDb(); } catch (_) {}
        db.deleteAllUsers();
        console.log(`[Auth] Сброшены ВСЕ пользователи (by ${session.username})`);
        safeLog(session, 'users_reset', null, null, null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Восстановление пользователей из .env (level 5)
    if (req.url === '/api/users/restore-env' && req.method === 'POST') {
        const session = getSessionFromReq(req);
        if (!session || session.level < 5) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав (нужен уровень 5)' }));
            return;
        }
        const restored = db.restoreUsersFromEnv();
        safeLog(session, 'users_restore_env', null, null, `restored=${restored || 0}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, restored }));
        return;
    }

    // Пригласительные коды (только level 5)
    if (req.method === 'GET' && req.url.startsWith('/api/invites')) {
        const inviteUrl = new URL(req.url, `http://${req.headers.host}`);
        if (inviteUrl.pathname !== '/api/invites') {
            // Not this route (e.g. /api/invites/generate)
        } else {
        const session = getSessionFromReq(req);
        if (!session || session.level < 5) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав (нужен уровень 5)' }));
            return;
        }
        const includeUsed = inviteUrl.searchParams.get('used') === '1';
        const codes = db.getInviteCodes(includeUsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ codes }));
        return;
        }
    }

    if (req.url === '/api/invites/generate' && req.method === 'POST') {
        const session = getSessionFromReq(req);
        if (!session || session.level < 5) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав (нужен уровень 5)' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { level } = JSON.parse(body || '{}');
                const lvl = Math.min(Math.max(parseInt(level) || 1, 1), 5);
                const code = db.createInviteCode(lvl, session.userId);
                console.log(`[Auth] Создан пригласительный код (level=${lvl}) by ${session.username}`);
                safeLog(session, 'invite_generate', null, null, `level=${lvl} code=${code}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, code }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (req.method === 'DELETE' && req.url.startsWith('/api/invites/')) {
        const session = getSessionFromReq(req);
        if (!session || session.level < 5) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав (нужен уровень 5)' }));
            return;
        }
        const inviteUrl = new URL(req.url, `http://${req.headers.host}`);
        const code = decodeURIComponent(inviteUrl.pathname.replace('/api/invites/', '') || '').trim();
        if (!code) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Код не указан' }));
            return;
        }
        const ok = db.deleteInviteCode(code);
        if (!ok) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Код не найден' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        safeLog(session, 'invite_delete', null, null, `code=${code}`);
        return;
    }

    // Проверка пригласительного кода без использования (публичный)
    if (req.url.startsWith('/api/auth/validate-invite') && req.method === 'GET') {
        const u = new URL(req.url, `http://${req.headers.host}`);
        const code = u.searchParams.get('code');
        const level = code ? db.validateInviteCode(String(code).trim()) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(level !== null ? { valid: true, level } : { valid: false }));
        return;
    }

    // Регистрация по пригласительному коду (публичный endpoint)
    if (req.url === '/api/auth/register-by-invite' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password, inviteCode } = JSON.parse(body || '{}');
                if (!username || !password || !inviteCode) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Введите логин, пароль и пригласительный код' }));
                    return;
                }
                const level = db.useInviteCode(String(inviteCode).trim());
                if (level === null) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Недействительный или уже использованный код' }));
                    return;
                }
                if (username.length < 2 || username.length > 32 || !/^[a-zA-Z0-9_\-а-яА-ЯёЁ]+$/.test(username)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Логин: 2-32 символа, буквы/цифры/_/-' }));
                    return;
                }
                if (password.length < 6) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Пароль минимум 6 символов' }));
                    return;
                }
                const id = db.createUser(username, password, username, level);
                const userData = { id, username, displayName: username, level };
                const session = auth.createSession(userData);
                console.log(`[Auth] Регистрация по коду: ${username} (level=${level})`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    user: userData,
                    sessionToken: session.token,
                    expiresAt: session.expiresAt
                }));
            } catch (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Пользователь с таким логином уже существует' }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            }
        });
        return;
    }

    // Очистка кэша (level >= 4)
    if (req.url === '/api/clear-cache' && req.method === 'POST') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        cache.players.data = null;
        cache.players.timestamp = 0;
        cache.vacBans.data = null;
        cache.vacBans.timestamp = 0;
        cache.yoomaBans.data = null;
        cache.yoomaBans.timestamp = 0;
        cache.suspiciousBans.data = null;
        cache.suspiciousBans.timestamp = 0;
        cache.cs2redBans.data = null;
        cache.cs2redBans.timestamp = 0;
        cache.deti00Bans.data = null;
        cache.deti00Bans.timestamp = 0;
        cache.pridecs2Bans.data = null;
        cache.pridecs2Bans.timestamp = 0;
        cache.top2Bans.data = null;
        cache.top2Bans.timestamp = 0;
        cache.playerGames.clear();
        
        console.log('Кэш очищен');
        safeLog(session, 'cache_clear', null, null, null);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Cache cleared' }));
        return;
    }

    // Проверка сессии
    if (req.url === '/api/auth/session' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const parsed = body ? JSON.parse(body) : {};
                const sessionToken = parsed && parsed.sessionToken ? String(parsed.sessionToken) : '';
                const session = sessionToken ? auth.getSession(sessionToken) : getSessionFromReq(req);
                if (session) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        valid: true,
                        session: {
                            userId: session.userId,
                            username: session.username,
                            displayName: session.displayName,
                            level: session.level,
                            expiresAt: session.expiresAt
                        }
                    }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: false, error: 'UNAUTHORIZED' }));
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }
    
    // Выход (logout)
    if (req.url === '/api/auth/logout' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const parsed = body ? JSON.parse(body) : {};
                const sessionToken = parsed && parsed.sessionToken ? String(parsed.sessionToken) : '';
                const token = sessionToken || String(getCookieValue(req.headers.cookie || '', 'sessionToken') || '');
                if (token) auth.deleteSession(token);
                
                const cookieSecure = IS_PROD ? 'Secure; ' : '';
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': [
                        `sessionToken=; Path=/; SameSite=Lax; HttpOnly; ${cookieSecure}Max-Age=0`,
                        `XSRF-TOKEN=; Path=/; SameSite=Lax; ${cookieSecure}Max-Age=0`
                    ]
                });
                res.end(JSON.stringify({ success: true, message: 'Logged out' }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }
    
    if (req.url === '/api/logs' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_WHITELIST) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        const logs = (db.getActionLogs(200, 0) || []).filter(l => l && l.action_type !== 'view_bans').slice(0, 100);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs }));
        return;
    }
    
    if (req.url === '/api/whitelist' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Не авторизован' }));
            return;
        }
        const whitelist = db.getWhitelist();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ whitelist }));
        return;
    }
    
    // --- Activity graph data ---
    if (req.url.startsWith('/api/activity') && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Не авторизован' }));
            return;
        }
        const parsed = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const range = parsed.searchParams.get('range');
        const history = db.getServerActivityRange(range === 'day' || range === 'week' || range === 'all' ? range : 'day');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ activity: history, range: range === 'day' || range === 'week' || range === 'all' ? range : 'day' }));
        return;
    }

    // --- Staff list (filtered) ---
    if (req.url === '/api/staff' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            staffList: staffPunishmentsCache.staffList,
            lastUpdated: staffPunishmentsCache.staffListLastUpdated
        }));
        return;
    }

    if (req.url === '/api/fear/admins/find' && req.method === 'POST') {
        const session = requireSession(req, res, 3);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const parsed = JSON.parse(body || '{}');
                const accessToken = String(parsed.accessToken || '').trim();
                const authMode = String(parsed.authMode || 'cookie').toLowerCase() === 'bearer' ? 'bearer' : 'cookie';
                const key = String(parsed.key || '').trim();
                if (!accessToken) {
                    safeLog(session, 'fear_admins_find_error', null, null, 'reason=missing_token');
                    sendError(res, 400, 'ACCESS_TOKEN_REQUIRED', 'Укажите access token');
                    return;
                }
                const h = authMode === 'bearer'
                    ? { Authorization: `Bearer ${accessToken}` }
                    : { Cookie: `access_token=${accessToken}` };
                const apiRes = await fearAdminsRequest(FEAR_ADMINS_LIST_PATH, 'GET', h);
                if (apiRes.statusCode >= 400) {
                    safeLog(session, 'fear_admins_find_error', null, null, `status=${apiRes.statusCode} mode=${authMode} key=${key || '-'}`);
                    sendJson(res, apiRes.statusCode, { error: apiRes.bodyText || 'Fear API error' });
                    return;
                }
                sendJson(res, 200, { payload: apiRes.bodyJson ?? apiRes.bodyText });
                let count = 0;
                try {
                    const payload = apiRes.bodyJson ?? apiRes.bodyText;
                    const list = Array.isArray(payload)
                        ? payload
                        : (Array.isArray(payload?.admins) ? payload.admins : (Array.isArray(payload?.data) ? payload.data : []));
                    count = Array.isArray(list) ? list.length : 0;
                } catch (_) {}
                safeLog(session, 'fear_admins_find', null, null, `mode=${authMode} key=${key || '-'} count=${count}`);
            } catch (err) {
                safeLog(session, 'fear_admins_find_error', null, null, `exception=${String(err?.message || err || 'unknown')}`);
                sendError(res, 500, 'FEAR_PROXY_ERROR', err.message || 'Fear API request failed');
            }
        });
        return;
    }

    if (req.url === '/api/fear/admins/edit' && req.method === 'POST') {
        const session = requireSession(req, res, 3);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const parsed = JSON.parse(body || '{}');
                const accessToken = String(parsed.accessToken || '').trim();
                const authMode = String(parsed.authMode || 'cookie').toLowerCase() === 'bearer' ? 'bearer' : 'cookie';
                const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
                if (!accessToken) {
                    safeLog(session, 'fear_admins_edit_error', null, null, 'reason=missing_token');
                    sendError(res, 400, 'ACCESS_TOKEN_REQUIRED', 'Укажите access token');
                    return;
                }
                if (!payload) {
                    safeLog(session, 'fear_admins_edit_error', null, null, 'reason=invalid_payload');
                    sendError(res, 400, 'INVALID_PAYLOAD', 'Некорректный payload');
                    return;
                }
                const h = authMode === 'bearer'
                    ? { Authorization: `Bearer ${accessToken}` }
                    : { Cookie: `access_token=${accessToken}` };
                const apiRes = await fearAdminsRequest(FEAR_ADMINS_EDIT_PATH, 'POST', h, payload);
                sendJson(res, apiRes.statusCode, apiRes.bodyJson ?? { raw: apiRes.bodyText });
                const id = payload.id ?? payload.admin_id ?? '';
                const gid = payload.groupId ?? payload.group_id ?? '';
                const sid = payload.steamid ?? payload.steamId ?? '';
                const nm = payload.name ?? '';
                if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                    safeLog(session, 'fear_admins_edit', String(sid || ''), String(nm || ''), `id=${id} group=${gid} mode=${authMode}`);
                } else {
                    safeLog(session, 'fear_admins_edit_error', String(sid || ''), String(nm || ''), `status=${apiRes.statusCode} id=${id} group=${gid} mode=${authMode}`);
                }
            } catch (err) {
                safeLog(session, 'fear_admins_edit_error', null, null, `exception=${String(err?.message || err || 'unknown')}`);
                sendError(res, 500, 'FEAR_PROXY_ERROR', err.message || 'Fear API request failed');
            }
        });
        return;
    }
    // --- Maintenance banner (public) ---
    if (req.url === '/api/maintenance' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (session && session.level >= USER_LEVEL_SUPER) {
            sendJson(res, 200, { active: false, message: '', suppressedForLevel: session.level });
            return;
        }
        const active = db.getSetting('maintenance_active', 'false') === 'true';
        const message = db.getSetting('maintenance_message', 'Проводятся технические работы. Приносим извинения за неудобства.') || 'Проводятся технические работы.';
        sendJson(res, 200, { active, message });
        return;
    }
    if (req.url === '/api/maintenance' && req.method === 'POST') {
        const session = requireSession(req, res, USER_LEVEL_ADMIN);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { active, message } = JSON.parse(body || '{}');
                db.setSetting('maintenance_active', active ? 'true' : 'false');
                if (message !== undefined) db.setSetting('maintenance_message', String(message));
                safeLog(session, 'maintenance_set', null, null, `active=${active ? 'true' : 'false'}`);
                sendJson(res, 200, { success: true });
            } catch (_) {
                sendError(res, 400, 'INVALID_JSON', 'Invalid JSON');
            }
        });
        return;
    }

    // --- One-time update notice ---
    if (req.url === '/api/update-notice' && req.method === 'GET') {
        const active = db.getSetting('update_notice_active', 'false') === 'true';
        const message = db.getSetting('update_notice_message', '') || '';
        const id = db.getSetting('update_notice_id', '0') || '0';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ active, message, id }));
        return;
    }
    if (req.url === '/api/update-notice' && req.method === 'POST') {
        const session = requireSession(req, res, 5);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { message } = JSON.parse(body || '{}');
                const clean = String(message || '').trim();
                if (!clean) {
                    db.setSetting('update_notice_active', 'false');
                    db.setSetting('update_notice_message', '');
                    db.setSetting('update_notice_id', '0');
                    sendJson(res, 200, { success: true, active: false, id: '0' });
                    safeLog(session, 'update_notice_clear', null, null, null);
                    return;
                }
                const nextId = String(Date.now());
                db.setSetting('update_notice_active', 'true');
                db.setSetting('update_notice_message', clean);
                db.setSetting('update_notice_id', nextId);
                sendJson(res, 200, { success: true, active: true, id: nextId });
                safeLog(session, 'update_notice_set', null, null, `id=${nextId}`);
            } catch (_) {
                sendError(res, 400, 'INVALID_JSON', 'Invalid JSON');
            }
        });
        return;
    }

    // --- Settings API (level >= 4) ---
    if (req.url === '/api/settings' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        const settings = db.getAllSettings();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(settings));
        return;
    }
    if (req.url === '/api/settings' && req.method === 'POST') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                for (const [key, value] of Object.entries(data)) {
                    db.setSetting(key, value);
                }
                safeLog(session, 'settings_update', null, null, Object.keys(data || {}).join(','));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (_) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // --- Staff roles for payouts (ГА / СТА / СТМ / М / МЛ) — только 4+ (новая таблица / выплаты) ---
    if (req.url === '/api/staff-roles' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав' }));
            return;
        }
        const roles = db.getAllStaffRoles();
        sendJson(res, 200, { roles });
        return;
    }
    if (req.url === '/api/staff-roles' && req.method === 'POST') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_SUPER) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав (нужен уровень 5)' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { steamId, role } = JSON.parse(body || '{}');
                const sid = String(steamId || '').trim();
                const rawRole = String(role || '').trim().toUpperCase();
                const allowed = new Set(['GA', 'STA', 'STM', 'M', 'ML', 'AUTO']);
                if (!sid || !allowed.has(rawRole)) {
                    console.warn('[StaffRoles] BAD_REQUEST steamId=', sid, 'role=', rawRole);
                    sendError(res, 400, 'BAD_REQUEST', 'Некорректные данные');
                    return;
                }
                if (rawRole === 'AUTO') {
                    db.deleteStaffRole(sid);
                } else {
                    db.upsertStaffRole(sid, rawRole, session.userId, session.username);
                }
                sendJson(res, 200, { ok: true });
                safeLog(session, 'staff_role_set', sid, null, `role=${rawRole}`);
            } catch (_) {
                sendError(res, 400, 'INVALID_JSON', 'Invalid JSON');
            }
        });
        return;
    }

    // --- Staff payroll config (norms) for staff stats (level >= 4) ---
    if (req.url === '/api/staff-pay-config' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session || session.level < USER_LEVEL_ADMIN) {
            sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав');
            return;
        }
        const monthPunish = Number(db.getSetting('staff_norm_month_punish', '0') || 0) || 0;
        const monthTickets = Number(db.getSetting('staff_norm_month_tickets', '0') || 0) || 0;
        const weekPunish = Number(db.getSetting('staff_norm_week_punish', '0') || 0) || 0;
        const weekTickets = Number(db.getSetting('staff_norm_week_tickets', '0') || 0) || 0;
        sendJson(res, 200, {
            norms: {
                month: { punish: monthPunish, tickets: monthTickets },
                week: { punish: weekPunish, tickets: weekTickets }
            }
        });
        return;
    }

    // --- Получение уровня текущего пользователя по сессии ---
    if (req.url === '/api/me' && req.method === 'GET') {
        const session = requireSession(req, res, 0);
        if (!session) return;
        const user = db.getUserById(session.userId);
        const launcherApiKey = db.ensureUserLauncherApiKey(session.userId);
        sendJson(res, 200, {
            id: session.userId,
            username: session.username,
            displayName: session.displayName,
            level: session.level,
            steamId: user?.steamId || null,
            launcherApiKey: launcherApiKey || null
        });
        return;
    }

    if (req.url === '/api/runtime-metrics' && req.method === 'GET') {
        const session = requireSession(req, res, USER_LEVEL_SUPER);
        if (!session) return;
        const api = Array.from(runtimeMetrics.api.entries()).map(([route, m]) => ({
            route,
            count: m.count,
            avgMs: Number((m.totalMs / Math.max(1, m.count)).toFixed(2)),
            maxMs: m.maxMs
        })).sort((a, b) => b.maxMs - a.maxMs);
        const jobs = Array.from(runtimeMetrics.jobs.entries()).map(([name, m]) => ({
            name,
            count: m.count,
            avgMs: Number((m.totalMs / Math.max(1, m.count)).toFixed(2)),
            maxMs: m.maxMs
        })).sort((a, b) => b.maxMs - a.maxMs);
        sendJson(res, 200, {
            env: {
                NODE_ENV: process.env.NODE_ENV || 'development',
                RAILWAY_LIGHT_MODE,
                BG_CYCLE_MS,
                BG_STAGGER_MS,
                PUNISHMENTS_REQ_TIMEOUT_MS
            },
            api,
            jobs
        });
        return;
    }

    // --- Player check (local cache only with ?local=1, full check otherwise) ---
    if (req.url.startsWith('/api/check/') && req.method === 'GET') {
        const sid = req.url.split('/api/check/')[1]?.split('?')[0];
        if (!sid || !/^\d{5,}$/.test(sid)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid steamId' }));
            return;
        }
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const localOnly = urlObj.searchParams.get('local') === '1';
        const checkLocal = () => {
            const player = { steamId: sid, bans: [], comments: [], online: false };
            const cached = getCachedData('players');
            if (cached) {
                const ctx = buildOnlinePlayersContext(cached);
                const data = ctx.playerDataMap.get(sid);
                if (data) {
                    player.online = true;
                    player.nickname = data.nickname;
                    player.avatar = data.avatar;
                    player.kills = data.kills;
                    player.deaths = data.deaths;
                    player.serverName = data.serverName;
                    player.serverGame = data.serverGame;
                }
            }
            const cachedVac = getCachedData('vacBans');
            if (cachedVac?.allBans) {
                const vb = cachedVac.allBans.find(p => String(p.SteamId) === sid);
                if (vb) player.bans.push({ source: 'VAC', gameBans: vb.NumberOfGameBans, daysSince: vb.DaysSinceLastBan });
            }
            const cachedYooma = getCachedData('yoomaBans');
            if (cachedYooma?.allBans) {
                const yb = cachedYooma.allBans.find(p => String(p.steamId) === sid);
                if (yb) player.bans.push({ source: 'Yooma', reason: yb.reason, created: yb.created });
            }
            const cachedSusp = getCachedData('suspiciousBans');
            if (cachedSusp?.allBans) {
                const sb = cachedSusp.allBans.find(p => String(p.steamId) === sid);
                if (sb) player.bans.push({ source: 'DXD', reason: sb.reason });
            }
            const cachedDeti00 = getCachedData('deti00Bans');
            if (cachedDeti00?.allBans) {
                const db00 = cachedDeti00.allBans.find(p => String(p.steamId) === sid);
                if (db00) player.bans.push({ source: 'Deti00', reason: db00.reason, date: db00.date, expires: db00.expires });
            }
            const cachedPride = getCachedData('pridecs2Bans');
            if (cachedPride?.allBans) {
                const pb = cachedPride.allBans.find(p => String(p.steamId) === sid);
                if (pb) player.bans.push({ source: 'PrideCS2', reason: pb.reason, date: pb.date, expires: pb.expires });
            }
            const cachedTop2 = getCachedData('top2Bans');
            if (cachedTop2?.allBans) {
                const t2 = cachedTop2.allBans.find(p => String(p.steamId) === sid);
                if (t2) player.bans.push({ source: 'Top2', reason: t2.reason, date: t2.date, expires: t2.expires });
            }
            player.whitelisted = db.isWhitelisted(sid);
            player.comments = db.getBanComments(sid);
            const accAge = cache.accountAge.get(sid);
            if (accAge) player.accountCreated = accAge.created;
            if (!player.nickname) {
                const allSources = [...(cachedVac?.allBans || []), ...(cachedYooma?.allBans || []), ...(cachedSusp?.allBans || []), ...(cachedDeti00?.allBans || []), ...(cachedPride?.allBans || []), ...(cachedTop2?.allBans || [])];
                const found = allSources.find(p => String(p.SteamId || p.steamId) === sid);
                if (found) { player.nickname = found.nickname || found.name; player.avatar = found.avatar; }
            }
            return player;
        };
        if (localOnly) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ local: checkLocal(), fear: null, yooma: null, steam: null, cs2red: null, deti00: null, pride: null, top2: null, faceit: null }));
            return;
        }

        const TIMEOUT_FAST = 5000;
        const TIMEOUT_SLOW = 6000;

        const httpGet = (url, opts = {}) => new Promise((resolve) => {
            const timeout = opts.timeout || TIMEOUT_SLOW;
            const r = https.get(url, { headers: opts.headers || {} }, (apiRes) => {
                let d = '';
                apiRes.on('data', c => d += c);
                apiRes.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
            });
            r.on('error', () => resolve(null));
            r.setTimeout(timeout, () => { r.destroy(); resolve(null); });
        });

        const htmlGet = (url, headers) => new Promise((resolve) => {
            const r = https.get(url, { headers }, (apiRes) => {
                let d = '';
                apiRes.on('data', c => d += c);
                apiRes.on('end', () => resolve({ status: apiRes.statusCode, html: d }));
            });
            r.on('error', () => resolve(null));
            r.setTimeout(TIMEOUT_SLOW, () => { r.destroy(); resolve(null); });
        });

        const strip = s => s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

        const parseMaterialBans = (html) => {
            if (!html || html.length < 1000) return { banned: false };
            const isBanned = /badge_banned/.test(html);
            if (!isBanned) return { banned: false };
            const bans = [];
            const bansSection = html.match(/Последние баны[\s\S]*?bans_comms_content[\s\S]*?<\/ul>/);
            if (bansSection) {
                const rows = bansSection[0].match(/<li>[\s\S]*?<\/li>/g) || [];
                for (const row of rows) {
                    const spans = [...row.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m => strip(m[1]));
                    if (spans.length >= 5 && /\d{2}\.\d{2}\.\d{4}/.test(spans[0])) {
                        bans.push({ date: spans[0], reason: spans[1], admin: spans[2], duration: spans[3], expires: spans[4] });
                    }
                }
            }
            const lb = bans[0] || {};
            return { banned: bans.length > 0, reason: lb.reason, date: lb.date, expires: lb.expires, bans };
        };

        const checkFear = () => httpGet(`https://api.fearproject.ru/profile/${sid}`);

        const checkYooma = () => new Promise((resolve) => {
            const cachedYooma = getCachedData('yoomaBans');
            if (cachedYooma?.allBans) {
                const found = cachedYooma.allBans.find(p => String(p.steamId) === sid);
                if (found) return resolve({ banned: true, reason: found.reason, created: found.created, expires: found.expires, adminName: found.adminName, isPermanent: found.isPermanent });
            }
            let ws = null;
            const t = setTimeout(() => { if (ws) try { ws.close(); } catch {} resolve({ banned: false, timeout: true }); }, TIMEOUT_FAST);
            try {
                ws = new WebSocket('wss://yooma.su/api');
                ws.on('open', () => ws.send(JSON.stringify({ type: 'get_profile', steamid: sid })));
                ws.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'get_profile' && msg.profile && String(msg.profile.steam_id) === sid) {
                            if (msg.profile.ban) {
                                ws.send(JSON.stringify({ type: 'get_punishments', page: 1, punish_type: 0, search: sid, mobile: false }));
                            } else { clearTimeout(t); ws.close(); resolve({ banned: false }); }
                        }
                        if (msg.type === 'get_punishments' && msg.punishments) {
                            const p = msg.punishments.find(x => String(x.steamid) === sid);
                            clearTimeout(t); ws.close();
                            if (p && p.unpunish_admin_id == null) {
                                const now = Math.floor(Date.now() / 1000);
                                resolve(p.expires === 0 || p.expires > now ? { banned: true, reason: p.reason, created: p.created, expires: p.expires, adminName: p.admin_name, isPermanent: p.expires === 0 } : { banned: false });
                            } else resolve({ banned: false });
                        }
                    } catch {}
                });
                ws.on('error', () => { clearTimeout(t); resolve({ banned: false, error: true }); });
            } catch { clearTimeout(t); resolve({ banned: false, error: true }); }
        });

        const checkSteam = async () => {
            const steamGet = (url) => httpGet(url);
            const key = STEAM_API_KEY;
            const [summaries, bans, level, games, friends] = await Promise.allSettled([
                steamGet(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${key}&steamids=${sid}`),
                steamGet(`https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${key}&steamids=${sid}`),
                steamGet(`https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${key}&steamid=${sid}`),
                steamGet(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${key}&steamid=${sid}&include_appinfo=0&appids_filter[0]=730&format=json`),
                steamGet(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${key}&steamid=${sid}&relationship=friend`)
            ]);
            const profile = summaries.status === 'fulfilled' && summaries.value?.response?.players?.[0] || null;
            const banData = bans.status === 'fulfilled' && bans.value?.players?.[0] || null;
            const lvl = level.status === 'fulfilled' && level.value?.response?.player_level;
            const cs2 = games.status === 'fulfilled' && games.value?.response?.games?.find(g => g.appid === 730) || null;
            const friendList = friends.status === 'fulfilled' && friends.value?.friendslist?.friends || null;
            const friendIds = friendList ? friendList.map(f => f.steamid) : [];
            return {
                personaName: profile?.personaname || null,
                steamLevel: typeof lvl === 'number' ? lvl : null,
                cs2Hours: cs2 ? Math.floor((cs2.playtime_forever || 0) / 60) : null,
                friendCount: friendIds.length,
                friendIds,
                profileVisibility: profile?.communityvisibilitystate || null,
                country: profile?.loccountrycode || null,
                currentGame: profile?.gameextrainfo || null,
                currentGameId: profile?.gameid || null,
                personaState: profile?.personastate ?? null,
                lastLogoff: profile?.lastlogoff || null,
                avatarFull: profile?.avatarfull || null,
                realName: profile?.realname || null,
                vacBanned: banData?.VACBanned || false,
                numberOfVACBans: banData?.NumberOfVACBans || 0,
                communityBanned: banData?.CommunityBanned || false,
                economyBan: banData?.EconomyBan || 'none',
                numberOfGameBans: banData?.NumberOfGameBans || 0,
                daysSinceLastBan: banData?.DaysSinceLastBan || 0
            };
        };

        const checkCs2red = async () => {
            const data = await httpGet(`https://cs2red.ru/api/profile?steamid=${sid}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://cs2red.ru/',
                    'Origin': 'https://cs2red.ru'
                }
            });
            if (!data || !data.success || !data.user) return { found: false };
            const u = data.user;
            const rank = u.rank || {};
            const activeBans = (u.bans || []).filter(b => {
                if (b.unbanId) return false;
                const now = Math.floor(Date.now() / 1000);
                const endTs = Number(b.endTimeStamp);
                return endTs === 0 || (Number.isFinite(endTs) && endTs > now);
            });
            return {
                found: true, nick: u.nick,
                kills: rank.kills || 0, deaths: rank.deaths || 0,
                banned: activeBans.length > 0,
                bans: activeBans.map(b => {
                    const endTs = Number(b.endTimeStamp);
                    const ts = Number(b.timestamp);
                    return {
                        reason: b.reason,
                        timestamp: Number.isFinite(ts) ? ts : b.timestamp,
                        endTimestamp: Number.isFinite(endTs) ? endTs : b.endTimeStamp,
                        isPermanent: endTs === 0
                    };
                })
            };
        };

        const materialHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'identity'
        };

        const checkDeti00 = async () => {
            const cachedDeti00 = getCachedData('deti00Bans');
            if (cachedDeti00?.allBans) {
                const found = cachedDeti00.allBans.find(p => String(p.steamId) === sid);
                if (found) return { banned: true, reason: found.reason, date: found.date, expires: found.expires, bans: found.bans };
            }
            const r = await htmlGet(`https://deti00ykh.ru/profiles/${sid}/block/12/`, { ...materialHeaders, Referer: `https://deti00ykh.ru/profiles/${sid}/?search=1` });
            return r?.status === 200 ? parseMaterialBans(r.html) : { banned: false };
        };

        const checkPride = async () => {
            const cachedPride = getCachedData('pridecs2Bans');
            if (cachedPride?.allBans) {
                const found = cachedPride.allBans.find(p => String(p.steamId) === sid);
                if (found) return { banned: true, reason: found.reason, date: found.date, expires: found.expires, bans: found.bans };
            }
            const r = await htmlGet(`https://pridecs2.ru/profiles/${sid}/block/0/`, { ...materialHeaders, Referer: `https://pridecs2.ru/profiles/${sid}/?search=1` });
            return r?.status === 200 ? parseMaterialBans(r.html) : { banned: false };
        };

        const checkTop2 = async () => {
            const cachedTop2 = getCachedData('top2Bans');
            if (cachedTop2?.allBans) {
                const found = cachedTop2.allBans.find(p => String(p.steamId) === sid);
                if (found) return { banned: true, reason: found.reason, date: found.date, expires: found.expires, bans: found.bans };
            }
            const r = await htmlGet(`https://top2.fun/profiles/${sid}/block/0/`, { ...materialHeaders, Host: 'top2.fun', Referer: `https://top2.fun/profiles/${sid}/?search=1`, Cookie: 'PHPSESSID=647e9c72684a75b3cd7ba27154d50fb0' });
            return r?.status === 200 ? parseMaterialBans(r.html) : { banned: false };
        };

        const checkFaceit = async () => {
            if (!FACEIT_API_KEY) return null;
            const data = await httpGet(`https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${sid}`, {
                timeout: TIMEOUT_FAST,
                headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
            });
            if (!data || data.errors || !data.player_id) return null;
            const cs2 = data.games?.cs2;
            return {
                faceitId: data.player_id,
                nickname: data.nickname,
                faceitLevel: cs2?.skill_level || null,
                faceitElo: cs2?.faceit_elo || null,
                faceitUrl: data.faceit_url ? data.faceit_url.replace('{lang}', 'en') : null
            };
        };

        const checkCSStatsWmpvp = () => new Promise((resolve) => {
            const postData = JSON.stringify({ toSteamId: sid, mySteamId: sid, accessToken: '' });
            const toNumOrNull = (value) => {
                const n = typeof value === 'number' ? value : parseFloat(value);
                return Number.isFinite(n) ? n : null;
            };
            const toPercentOrNull = (value) => {
                const n = typeof value === 'number' ? value : parseFloat(value);
                if (!Number.isFinite(n)) return null;
                if (n > 0 && n <= 1) return +(n * 100).toFixed(2);
                return +n.toFixed(2);
            };
            const options = {
                hostname: 'api.wmpvp.com',
                path: '/api/csgo/home/official/detailStats',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'okhttp/4.11.0',
                    'gameType': '1,2',
                    'gameTypeStr': '1,2',
                    't': Math.floor(Date.now() / 1000).toString(),
                    'Content-Length': Buffer.byteLength(postData)
                }
            };
            const r = https.request(options, (apiRes) => {
                let d = '';
                apiRes.on('data', c => d += c);
                apiRes.on('end', () => {
                    try {
                        const json = JSON.parse(d);
                        if (!json || !json.data || typeof json.data !== 'object') {
                            console.log(`[CSStats] ${sid}: no data`);
                            return resolve(null);
                        }
                        const s = json.data;
                        resolve({
                            kd: toNumOrNull(s.kd),
                            winPct: toPercentOrNull(s.winRate),
                            hsPct: toPercentOrNull(s.headShotRatio),
                            adr: toNumOrNull(s.adr),
                            rating: toNumOrNull(s.rating),
                            kast: toPercentOrNull(s.kast),
                            rws: toNumOrNull(s.rws),
                            entryKill: toPercentOrNull(s.entryKillRatio),
                            hours: toNumOrNull(s.hours)
                        });
                    } catch (e) {
                        console.log(`[CSStats] Parse error: ${e.message}`);
                        resolve(null);
                    }
                });
            });
            r.on('error', (e) => { console.log(`[CSStats] Request error: ${e.message}`); resolve(null); });
            r.setTimeout(TIMEOUT_SLOW, () => { r.destroy(); resolve(null); });
            r.write(postData);
            r.end();
        });

        const normalizePercent = (value) => {
            const n = typeof value === 'number' ? value : parseFloat(value);
            if (!Number.isFinite(n)) return null;
            if (n > 0 && n <= 1) return +(n * 100).toFixed(2);
            return +n.toFixed(2);
        };

        const normalizeNum = (value) => {
            const n = typeof value === 'number' ? value : parseFloat(value);
            return Number.isFinite(n) ? +n : null;
        };

        const hasUsefulCSStats = (stats) => {
            if (!stats) return false;
            const vals = [stats.kd, stats.winPct, stats.hsPct, stats.adr, stats.rating, stats.kast, stats.rws, stats.entryKill, stats.hours];
            return vals.some(v => typeof v === 'number' && v > 0);
        };

        const mapStatsObject = (raw) => {
            if (!raw || typeof raw !== 'object') return null;
            const mapped = {
                kd: normalizeNum(raw.kd ?? raw.kdr ?? raw.kdRatio),
                winPct: normalizePercent(raw.winRate ?? raw.winrate ?? raw.wr ?? raw.winPct),
                hsPct: normalizePercent(raw.headShotRatio ?? raw.headshotRatio ?? raw.hs ?? raw.hsPct),
                adr: normalizeNum(raw.adr),
                rating: normalizeNum(raw.rating ?? raw.hltvRating ?? raw.hltv),
                kast: normalizePercent(raw.kast),
                rws: normalizeNum(raw.rws),
                entryKill: normalizePercent(raw.entryKillRatio ?? raw.entryKill ?? raw.entrySuccess),
                hours: normalizeNum(raw.hours ?? raw.playtimeHours)
            };
            return mapped;
        };

        const findStatsObjectDeep = (root) => {
            const queue = [root];
            let scanned = 0;
            while (queue.length > 0 && scanned < 5000) {
                const cur = queue.shift();
                scanned++;
                if (!cur || typeof cur !== 'object') continue;
                const mapped = mapStatsObject(cur);
                if (mapped && hasUsefulCSStats(mapped)) return mapped;
                if (Array.isArray(cur)) {
                    for (const item of cur) queue.push(item);
                } else {
                    for (const v of Object.values(cur)) queue.push(v);
                }
            }
            return null;
        };

        const checkCSStatsCsstatsGg = () => new Promise((resolve) => {
            if (!CSSTATS_COOKIE) return resolve(null);
            const req = https.get(`https://csstats.gg/player/${sid}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cookie': CSSTATS_COOKIE,
                    'Referer': 'https://csstats.gg/'
                }
            }, (apiRes) => {
                let html = '';
                apiRes.on('data', c => html += c);
                apiRes.on('end', () => {
                    try {
                        if (apiRes.statusCode !== 200 || !html) return resolve(null);
                        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
                        if (!nextDataMatch?.[1]) return resolve(null);
                        const nextData = JSON.parse(nextDataMatch[1]);
                        const stats = findStatsObjectDeep(nextData);
                        resolve(stats || null);
                    } catch (e) {
                        console.log(`[CSStatsGG] Parse error: ${e.message}`);
                        resolve(null);
                    }
                });
            });
            req.on('error', (e) => {
                console.log(`[CSStatsGG] Request error: ${e.message}`);
                resolve(null);
            });
            req.setTimeout(TIMEOUT_SLOW, () => { req.destroy(); resolve(null); });
        });

        const checkCSStats = async () => {
            const fromGg = await checkCSStatsCsstatsGg();
            if (fromGg && hasUsefulCSStats(fromGg)) return fromGg;
            return checkCSStatsWmpvp();
        };

        try {
            const [local, fear, yooma, steam, cs2red, deti00, pride, top2, faceit] = await Promise.allSettled([
                checkLocal(),
                checkFear(),
                checkYooma(),
                checkSteam(),
                checkCs2red(),
                checkDeti00(),
                checkPride(),
                checkTop2(),
                checkFaceit()
            ]);
            const result = {
                local: local.status === 'fulfilled' ? local.value : {},
                fear: fear.status === 'fulfilled' ? fear.value : null,
                yooma: yooma.status === 'fulfilled' ? yooma.value : null,
                steam: steam.status === 'fulfilled' ? steam.value : null,
                cs2red: cs2red.status === 'fulfilled' ? cs2red.value : null,
                deti00: deti00.status === 'fulfilled' ? deti00.value : null,
                pride: pride.status === 'fulfilled' ? pride.value : null,
                top2: top2.status === 'fulfilled' ? top2.value : null,
                faceit: faceit.status === 'fulfilled' ? faceit.value : null
            };

            // On-demand sync: если в full check точно нашли активный CS2Red бан,
            // обновляем кэш `cs2redBans`, чтобы таблица/«Опасные» подтянула его сразу.
            try {
                if (cs2red.status === 'fulfilled' && cs2red.value?.found && cs2red.value?.banned && Array.isArray(cs2red.value?.bans) && cs2red.value.bans.length > 0) {
                    const sidStr = String(sid);
                    const existing = getCachedData('cs2redBans');
                    const existingAll = Array.isArray(existing?.allBans) ? existing.allBans : [];
                    const kept = existingAll.filter(p => String(p.steamId) !== sidStr);

                    const reason = cs2red.value.bans.map(b => b.reason || 'CS2Red').join(', ');
                    const nickname = cs2red.value.nick || result.steam?.personaName || 'Unknown';
                    const avatar = result.steam?.avatarFull || result.steam?.avatar || null;

                    kept.push({
                        steamId: sidStr,
                        nickname,
                        avatar,
                        reason: reason || 'CS2Red',
                        bans: cs2red.value.bans
                    });

                    setCachedData('cs2redBans', { allBans: kept, timestamp: Date.now() });
                    broadcastUpdate('suspicious_bans_update', {});
                }
            } catch (_) {}

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Check failed' }));
        }
        return;
    }

    // --- Steam friends (for check panel) ---
    if (req.url.startsWith('/api/steam-friends/') && req.method === 'GET') {
        const steamId = req.url.split('/api/steam-friends/')[1]?.split('?')[0];
        if (!steamId || !/^\d{5,}$/.test(steamId) || !STEAM_API_KEY) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid steamId or API key' }));
            return;
        }
        const httpGet = (url) => new Promise((resolve) => {
            const r = https.get(url, (apiRes) => {
                let d = '';
                apiRes.on('data', c => d += c);
                apiRes.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
            });
            r.on('error', () => resolve(null));
            r.setTimeout(6000, () => { r.destroy(); resolve(null); });
        });
        (async () => {
            const fl = await httpGet(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&relationship=friend`);
            const ids = fl?.friendslist?.friends?.map(f => f.steamid) || [];
            if (ids.length === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ friends: [] }));
                return;
            }
            const batches = [];
            for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
            const summaries = await Promise.all(batches.map(b => httpGet(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${b.join(',')}`)));
            const friends = [];
            for (const s of summaries) {
                const players = s?.response?.players || [];
                for (const p of players) {
                    friends.push({ steamId: p.steamid, nickname: p.personaname || 'Unknown', avatar: p.avatarfull || null });
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ friends }));
        })();
        return;
    }

    // --- Steam avatar by SteamID (for authorized user card) ---
    if (req.url.startsWith('/api/steam-avatar/') && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Не авторизован' }));
            return;
        }
        const steamId = req.url.split('/api/steam-avatar/')[1]?.split('?')[0];
        if (!steamId || !/^\d{5,}$/.test(steamId) || !STEAM_API_KEY) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid steamId or API key' }));
            return;
        }
        try {
            const cached = steamAvatarCache.get(String(steamId));
            if (cached && (nowMs() - cached.ts) <= STEAM_AVATAR_CACHE_TTL_MS) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steamId, avatar: cached.avatar || null }));
                return;
            }
        } catch (_) {}
        const httpGetJson = (url) => new Promise((resolve) => {
            const r = https.get(url, (apiRes) => {
                let d = '';
                apiRes.on('data', c => d += c);
                apiRes.on('end', () => {
                    try { resolve(JSON.parse(d)); } catch (_) { resolve(null); }
                });
            });
            r.on('error', () => resolve(null));
            r.setTimeout(7000, () => { r.destroy(); resolve(null); });
        });
        const httpGetText = (url) => new Promise((resolve) => {
            const r = https.get(url, (apiRes) => {
                let d = '';
                apiRes.on('data', c => d += c);
                apiRes.on('end', () => resolve(d));
            });
            r.on('error', () => resolve(''));
            r.setTimeout(7000, () => { r.destroy(); resolve(''); });
        });
        (async () => {
            try {
                const summary = await httpGetJson(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId}`);
                const player = summary?.response?.players?.[0] || null;
                let avatar = player?.avatarfull || player?.avatarmedium || player?.avatar || null;
                if (!avatar) {
                    const xml = await httpGetText(`https://steamcommunity.com/profiles/${steamId}/?xml=1`);
                    const m = xml && xml.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/i);
                    if (m && m[1]) avatar = m[1];
                }
                steamAvatarCache.set(String(steamId), { avatar: avatar || null, ts: nowMs() });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    steamId,
                    avatar: avatar || null
                }));
            } catch (_) {
                try {
                    steamAvatarCache.set(String(steamId), { avatar: null, ts: nowMs() - STEAM_AVATAR_CACHE_NEGATIVE_TTL_MS + 1 });
                } catch (_) {}
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steamId, avatar: null }));
            }
        })();
        return;
    }
            
    // --- Ban comments: POST only (comments come from check-all/check-local) ---
    if (req.url === '/api/comments' && req.method === 'POST') {
        const session = getSessionFromReq(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Не авторизован' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { steamId, banSource, comment } = JSON.parse(body);
                if (!steamId || !comment || comment.length > 500) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Некорректные данные' }));
                    return;
                }
                db.addBanComment(steamId, banSource || 'manual', String(session.userId), session.username, comment);
                safeLog(
                    session,
                    'add_comment',
                    String(steamId),
                    String(banSource || 'manual'),
                    `Комментарий: ${String(comment).slice(0, 220)}`
                );
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (_) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid data' }));
            }
        });
        return;
    }

    // --- Staff punishment stats (кэш с запуска и каждый час) ---
    if (req.url === '/api/punishments/staff-stats' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Не авторизован' }));
            return;
        }
        if (session.level < USER_LEVEL_WHITELIST) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Недостаточно прав для статистики стаффа (нужен уровень 3+)' }));
            return;
        }
        try {
            const parsed = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const forceRefresh = parsed.searchParams.get('force') === '1';
            const noCacheYet = !staffPunishmentsCache.lastUpdated || !staffPunishmentsCache.dataBySteamId || Object.keys(staffPunishmentsCache.dataBySteamId).length === 0;
            if ((forceRefresh || noCacheYet) && !staffPunishmentsCache.loading) {
                await refreshStaffPunishmentsCache();
            }
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            staffList: staffPunishmentsCache.staffList,
            staffStatsData: staffPunishmentsCache.dataBySteamId,
            lastUpdated: staffPunishmentsCache.lastUpdated
        }));
        return;
    }

    // --- Staff tickets (ручной ввод) ---
    if (req.url.startsWith('/api/staff-tickets') && (req.method === 'GET' || req.method === 'POST')) {
        const session = getSessionFromReq(req);
        if (!session) {
            sendError(res, 401, 'UNAUTHORIZED', 'Не авторизован');
            return;
        }
        if (session.level < USER_LEVEL_ADMIN) {
            sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав (нужен уровень 4+)');
            return;
        }

        const parsed = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const ym = String(parsed.searchParams.get('ym') || '').trim();
        if (!/^\d{4}-\d{2}$/.test(ym)) {
            sendError(res, 400, 'BAD_YM', 'Нужен ym=YYYY-MM');
            return;
        }

        if (req.method === 'GET') {
            const rows = db.getStaffTicketsByMonth(ym);
            sendJson(res, 200, { ym, tickets: rows });
            return;
        }

        // POST: { steamId, tickets }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                const steamId = String(payload.steamId || '').trim();
                const tickets = payload.tickets;
                if (!/^\d{5,}$/.test(steamId)) {
                    sendError(res, 400, 'BAD_STEAMID', 'Некорректный steamId');
                    return;
                }
                const ok = db.upsertStaffTickets(steamId, ym, tickets, session.userId, session.username);
                if (!ok) {
                    sendError(res, 400, 'BAD_REQUEST', 'Не удалось сохранить');
                    return;
                }
                sendJson(res, 200, { ok: true });
            } catch (_) {
                sendError(res, 400, 'BAD_JSON', 'Некорректный JSON');
            }
        });
        return;
    }

    // --- Protected JS module: staff stats & payroll ---
    if (req.url === '/secure/staff-stats-secure.js' && req.method === 'GET') {
        const session = getSessionFromReq(req);
        if (!session) {
            sendError(res, 401, 'UNAUTHORIZED', 'Не авторизован');
            return;
        }
        if (session.level < USER_LEVEL_ADMIN) {
            sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав (нужен уровень 4+)');
            return;
        }
        try {
            const p = path.join(__dirname, 'secure', 'staff-stats-secure.js');
            const js = fs.readFileSync(p, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(js);
        } catch (e) {
            sendError(res, 500, 'READ_FAILED', 'Не удалось загрузить модуль');
        }
        return;
    }

    // --- Punishments (davidonchik.online: type=1 + type=2) ---
    if (req.url.startsWith('/api/punishments') && req.method === 'GET' && !req.url.startsWith('/api/punishments/')) {
        const session = getSessionFromReq(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Не авторизован' }));
            return;
        }
        const parsed = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const querySteamId = (parsed.searchParams.get('steamId') || '').trim();
        let adminSteamId = /^\d{5,}$/.test(querySteamId) ? querySteamId : PUNISHMENTS_ADMIN_STEAM_ID;
        if (session.level < USER_LEVEL_ADMIN) {
            const user = db.getUserById(session.userId);
            const ownSteamId = String(user?.steamId || '').trim();
            if (!/^\d{5,}$/.test(ownSteamId)) {
                sendError(res, 403, 'STEAM_ID_NOT_LINKED', 'SteamID не привязан к вашему аккаунту. Обратитесь к пользователю с уровнем 5.');
                return;
            }
            const requestedSteamId = /^\d{5,}$/.test(querySteamId) ? querySteamId : ownSteamId;
            // 1-2 уровень: можно смотреть свой SteamID (даже если он staff),
            // и можно смотреть любого другого, если он НЕ staff.
            // 3+ уровень: полный просмотр по SteamID, включая стафф (как у ГА).
            if (session.level < USER_LEVEL_WHITELIST && requestedSteamId !== ownSteamId && isSteamIdStaff(requestedSteamId)) {
                sendError(res, 403, 'STAFF_ACCESS_DENIED', 'Нельзя смотреть наказания стаффа. Доступно: ваш SteamID и любой не-стафф.');
                return;
            }
            adminSteamId = requestedSteamId;
        }
        // Для уровней 1-2 запрещаем смотреть наказания чужого стаффа,
        // но свой SteamID (даже если staff) разрешаем.
        if (adminSteamId && session.level < USER_LEVEL_ADMIN) {
            const user = db.getUserById(session.userId);
            const ownSteamId = String(user?.steamId || '').trim();
            if (session.level < USER_LEVEL_WHITELIST && adminSteamId !== ownSteamId && isSteamIdStaff(adminSteamId)) {
                sendError(res, 403, 'STAFF_ACCESS_DENIED', 'Нельзя смотреть наказания стаффа. Доступно: ваш SteamID и любой не-стафф.');
                return;
            }
        }
        if (!adminSteamId) {
            sendJson(res, 200, { count: 0, punishments: [] });
            return;
        }
        (async () => {
            const cached = getPunishmentsFromCache(adminSteamId);
            const cachedItem = getPunishmentsCacheEntry(adminSteamId);
            const cachedFresh = cached && cachedItem && (nowMs() - cachedItem.ts) <= PUNISHMENTS_CACHE_TTL_MS;
            if (cachedFresh) {
                sendJson(res, 200, { count: cached.length, punishments: cached, stale: false, source: 'cache' });
                return;
            }
            try {
                const response = await Promise.race([
                    fetchPunishmentsForSteamId(adminSteamId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PUNISHMENTS_REQ_TIMEOUT_MS))
                ]);
                const punishments = Array.isArray(response?.punishments) ? response.punishments : [];
                setPunishmentsToCache(adminSteamId, punishments);
                sendJson(res, 200, { count: punishments.length, punishments, stale: false, source: 'upstream' });
            } catch (_) {
                const stale = getPunishmentsFromCache(adminSteamId);
                if (stale) {
                    sendJson(res, 200, { count: stale.length, punishments: stale, stale: true, source: 'stale-cache' });
                    return;
                }
                sendJson(res, 200, { count: 0, punishments: [], stale: false });
            }
        })();
        return;
    }

    // --- Fear Reports proxy ---
    if (req.url === '/api/fear-reports' && req.method === 'GET') {
        const apiUrl = 'https://api.fearproject.ru/reports/recent';
        https.get(apiUrl, {
            headers: {
                'Accept': '*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                'Origin': 'https://fearproject.ru',
                'Referer': 'https://fearproject.ru/',
                'Cookie': `__ddg1_=g7Ui979pOEjDNf5BOT9p; access_token=${FEAR_ACCESS_TOKEN}`
            }
        }, (apiRes) => {
            let data = '';
            apiRes.on('data', c => data += c);
            apiRes.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
            });
        }).on('error', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
        });
        return;
    }

    // Активные репорты: типы + флаги (общий JSON для веба и оверлея)
    if (parsedUrl.pathname === '/api/active-reports' && req.method === 'GET') {
        const apiUrl = 'https://api.fearproject.ru/reports/recent';
        https.get(apiUrl, {
            headers: {
                'Accept': '*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                'Origin': 'https://fearproject.ru',
                'Referer': 'https://fearproject.ru/',
                'Cookie': `__ddg1_=g7Ui979pOEjDNf5BOT9p; access_token=${FEAR_ACCESS_TOKEN}`
            }
        }, (apiRes) => {
            let data = '';
            apiRes.on('data', c => data += c);
            apiRes.on('end', () => {
                try {
                    const raw = JSON.parse(data);
                    const payload = activeReportsApi.buildPublicPayload(raw);
                    sendJson(res, 200, payload);
                } catch (_) {
                    sendJson(res, 200, activeReportsApi.emptyPayload());
                }
            });
        }).on('error', () => {
            sendJson(res, 200, activeReportsApi.emptyPayload());
        });
        return;
    }

    // Единый снимок: все игроки на серверах Fear + флаги банов + активные репорты (модераторский API)
    if (parsedUrl.pathname === '/api/moderator/players' && req.method === 'GET') {
        (async () => {
            try {
                const hdr = String(req.headers.authorization || '');
                const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
                const qtok = String(parsedUrl.searchParams.get('token') || '').trim();
                let authorized = false;
                if (MODERATOR_API_TOKEN && (bearer === MODERATOR_API_TOKEN || qtok === MODERATOR_API_TOKEN)) {
                    authorized = true;
                } else {
                    const sess = auth.getSession(bearer);
                    if (sess && sess.level >= USER_LEVEL_ADMIN) authorized = true;
                }
                if (!authorized) {
                    sendError(
                        res,
                        401,
                        'UNAUTHORIZED',
                        'Нужен MODERATOR_API_TOKEN (заголовок Authorization: Bearer … или ?token=…) либо Bearer-сессия администратора (уровень 4+)'
                    );
                    return;
                }
                const rawReports = await moderatorPlayersSnapshot.fetchFearRecentReportsArray(FEAR_ACCESS_TOKEN);
                const reportsPayload = activeReportsApi.buildPublicPayload(rawReports);
                const cached = getCachedData('players');
                const banCaches = {
                    vacBans: getCachedData('vacBans'),
                    yoomaBans: getCachedData('yoomaBans'),
                    suspiciousBans: getCachedData('suspiciousBans'),
                    cs2redBans: getCachedData('cs2redBans'),
                    deti00Bans: getCachedData('deti00Bans'),
                    pridecs2Bans: getCachedData('pridecs2Bans'),
                    top2Bans: getCachedData('top2Bans')
                };
                const payload = moderatorPlayersSnapshot.buildModeratorPlayersSnapshot({
                    cachedServers: cached,
                    buildOnlinePlayersContext,
                    db,
                    cache,
                    reportsPayload,
                    banCaches,
                    userLevelForYooma: USER_LEVEL_SUPER,
                    USER_LEVEL_WHITELIST
                });
                sendJson(res, 200, payload);
            } catch (e) {
                sendError(res, 500, 'SNAPSHOT_ERROR', String(e && e.message ? e.message : e));
            }
        })();
        return;
    }

    // Лаунчер: один ответ — игроки онлайн (репорты + баны по проектам + дата аккаунта) + подозреваемые по репортам вне серверов + блок activeReports
    if (parsedUrl.pathname === '/api/launcher/players' && req.method === 'GET') {
        (async () => {
            try {
                const hdr = String(req.headers.authorization || '');
                const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
                const qtok = String(parsedUrl.searchParams.get('token') || '').trim();
                const xApiKey = String(req.headers['x-api-key'] || '').trim();
                const tok = bearer || qtok || xApiKey;
                const perUser = db.getUserByLauncherApiKey(tok);
                let userLevelForYooma = USER_LEVEL_SUPER;
                let authorized = false;
                if (perUser) {
                    authorized = true;
                    const lv = Number(perUser.level);
                    userLevelForYooma = Number.isFinite(lv) ? Math.min(Math.max(lv, 1), 5) : 1;
                } else if (LAUNCHER_API_KEY && tok === LAUNCHER_API_KEY) {
                    authorized = true;
                } else if (LAUNCHER_API_TOKEN && tok === LAUNCHER_API_TOKEN) {
                    authorized = true;
                } else if (MODERATOR_API_TOKEN && tok === MODERATOR_API_TOKEN) {
                    authorized = true;
                } else {
                    const sess = auth.getSession(bearer);
                    if (sess && sess.level >= USER_LEVEL_ADMIN) authorized = true;
                }
                if (!authorized) {
                    sendError(
                        res,
                        401,
                        'UNAUTHORIZED',
                        'Нужен личный API-ключ: раздел «Для лаунчера» на сайте (уровень 5) или GET /api/me по сессии. Либо заголовок Authorization: Bearer …, X-API-Key или ?token= (тот же ключ); для сервисов на хостинге — LAUNCHER_API_KEY / LAUNCHER_API_TOKEN / MODERATOR_API_TOKEN; либо Bearer-сессия администратора (уровень 4+).'
                    );
                    return;
                }
                const rawReports = await moderatorPlayersSnapshot.fetchFearRecentReportsArray(FEAR_ACCESS_TOKEN);
                const reportsPayload = activeReportsApi.buildPublicPayload(rawReports);
                const cached = getCachedData('players');
                const banCaches = {
                    vacBans: getCachedData('vacBans'),
                    yoomaBans: getCachedData('yoomaBans'),
                    suspiciousBans: getCachedData('suspiciousBans'),
                    cs2redBans: getCachedData('cs2redBans'),
                    deti00Bans: getCachedData('deti00Bans'),
                    pridecs2Bans: getCachedData('pridecs2Bans'),
                    top2Bans: getCachedData('top2Bans')
                };
                const payload = moderatorPlayersSnapshot.buildLauncherPlayersSnapshot({
                    cachedServers: cached,
                    buildOnlinePlayersContext,
                    db,
                    cache,
                    reportsPayload,
                    banCaches,
                    userLevelForYooma,
                    USER_LEVEL_WHITELIST
                });
                sendJson(res, 200, payload);
            } catch (e) {
                sendError(res, 500, 'SNAPSHOT_ERROR', String(e && e.message ? e.message : e));
            }
        })();
        return;
    }

    // Static files (strictly limited to /public to prevent path traversal)
    const publicDir = path.join(__dirname, '..', 'public');
    const rawUrlPath = String(req.url || '/').split('?')[0];
    // Block null bytes (can break path checks)
    if (rawUrlPath.includes('\0')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Роутинг для разных страниц
    let urlPath = rawUrlPath;
    let fileRelPath = (urlPath === '/' ? '/index.html' : urlPath);
    if (urlPath === '/auth' || urlPath === '/auth/') fileRelPath = '/auth.html';
    else if (urlPath === '/settings' || urlPath === '/settings/') fileRelPath = '/settings.html';
    else if (urlPath === '/logs' || urlPath === '/logs/') fileRelPath = '/logs.html';
    else if (urlPath === '/whitelist' || urlPath === '/whitelist/') fileRelPath = '/whitelist.html';
    else if (urlPath === '/faq' || urlPath === '/faq/') fileRelPath = '/faq.html';
    else if (urlPath === '/dashboard' || urlPath === '/dashboard/') fileRelPath = '/index.html';
    else if (urlPath === '/' || urlPath === '/home') fileRelPath = '/index.html';

    // Convert to safe relative path inside publicDir
    const rel = fileRelPath.replace(/^\/+/, '');
    const absPath = path.resolve(publicDir, rel);
    if (!absPath.startsWith(publicDir + path.sep) && absPath !== publicDir) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(absPath).toLowerCase();
    if (!mimeTypes[ext]) {
        res.writeHead(404);
        res.end('File not found');
        return;
    }

    // Защита JS ассетов: отдаём .js только авторизованным пользователям.
    // Для `<script>` нельзя проставить Authorization header, поэтому используем cookie `sessionToken`.
    if (ext === '.js') {
        const authHeader = req.headers['authorization'] || '';
        const bearer = String(authHeader).startsWith('Bearer ') ? String(authHeader).slice(7) : '';
        const tokenFromCookie = getSessionTokenFromCookie(req.headers.cookie || '');
        const sessionToken = bearer || tokenFromCookie || '';
        const session = sessionToken ? auth.getSession(sessionToken) : null;
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized');
            return;
        }
    }

    fs.stat(absPath, (err, st) => {
        if (err || !st || !st.isFile()) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const lastModified = st.mtime.toUTCString();
        const etag = '"' + crypto.createHash('sha1').update(String(st.size) + ':' + String(st.mtimeMs)).digest('hex') + '"';

        const isHtml = ext === '.html';
        const cacheControl = isHtml
            ? 'public, max-age=0, must-revalidate'
            : 'public, max-age=604800, immutable';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', cacheControl);
        res.setHeader('Last-Modified', lastModified);
        res.setHeader('ETag', etag);
        res.setHeader('Vary', 'Accept-Encoding');
        if (isHtml) {
            // Soft CSP (current HTML contains inline scripts/styles + a few external CDNs).
            res.setHeader(
                'Content-Security-Policy',
                [
                    "default-src 'self'",
                    "base-uri 'self'",
                    "object-src 'none'",
                    "frame-ancestors 'none'",
                    "img-src 'self' https: data:",
                    "font-src 'self' https: data:",
                    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
                    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
                    "connect-src 'self' https:"
                ].join('; ')
            );
        }

        const inm = String(req.headers['if-none-match'] || '');
        const ims = String(req.headers['if-modified-since'] || '');
        if ((inm && inm === etag) || (ims && ims === lastModified)) {
            res.writeHead(304);
            res.end();
            return;
        }

        const shouldGzip = wantsGzip(req) && isTextLikeContentType(contentType);
        if (shouldGzip) {
            res.setHeader('Content-Encoding', 'gzip');
        }
        res.writeHead(200);

        const stream = fs.createReadStream(absPath);
        stream.on('error', () => {
            if (!res.headersSent) res.writeHead(500);
            res.end('Internal error');
        });

        if (shouldGzip) {
            const gz = zlib.createGzip({ level: 6 });
            stream.pipe(gz).pipe(res);
        } else {
            stream.pipe(res);
        }
    });
});

// Функция для фоновой проверки часов в CS2 (батчами). forceRefresh — при периодическом запуске раз в 300 с

process.on('SIGINT', () => {
    console.log('\nЗавершение работы...');
    db.closeDatabase();
    process.exit(0);
});
process.on('SIGTERM', () => {
    db.closeDatabase();
    process.exit(0);
});

(async () => {
    await db.initialize();
    db.initDatabase();
    console.log('База данных:', db.getDbPath());

    server.listen(PORT, () => {
        console.log(`Сервер запущен на http://localhost:${PORT}`);
        console.log('Откройте браузер и перейдите по этому адресу');
        
        // Автоматическое обновление данных с env-тюнингом для Railway
        console.log('Запуск фоновой загрузки данных...');
        updateDataInBackground();
        setInterval(updateDataInBackground, BG_CYCLE_MS);

        // Staff list: первый раз через 5 сек после старта, далее каждые 24 часа
        setTimeout(() => refreshStaffList(), 5000);
        setInterval(refreshStaffList, STAFF_LIST_REFRESH_INTERVAL_MS);

        // Статистика наказаний стафа: далее каждый час
        setTimeout(() => refreshStaffPunishmentsCache(), 10000);
        setInterval(refreshStaffPunishmentsCache, STAFF_STATS_REFRESH_INTERVAL_MS);
    });
})().catch(err => {
    console.error('Ошибка запуска:', err);
    process.exit(1);
});

const wss = attachWss({
    server,
    auth,
    db,
    cache,
    STEAM_API_KEY,
    USER_LEVEL_WHITELIST,
    getClientIp,
    truncateForLog,
    sessionLogChunk,
    sendCurrentData,
    sendStats,
    sendVACBans,
    sendYoomaBans,
    sendSuspiciousBans,
    sendAllPlayers,
    sendFaceitLevels,
    sendPlayerGames,
    broadcastUpdate
});

// При подключении сразу шлём статистику и все списки (если есть кэш) — меньше гонок и пустых экранов
function sendCurrentData(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
        sendStats(ws);
    sendVACBans(ws);
    sendYoomaBans(ws);
    sendSuspiciousBans(ws);
}

// Количество «опасных» (DXDCS + VAC + Yooma, только кто сейчас на Fear, не в whitelist)
function getDangerousCount(currentSteamIds) {
    if (!currentSteamIds || currentSteamIds.size === 0) return 0;
    const cachedVac = getCachedData('vacBans');
    const cachedYooma = getCachedData('yoomaBans');
    const cachedSuspicious = getCachedData('suspiciousBans');
    const dangerousIds = new Set();
    if (cachedSuspicious && cachedSuspicious.allBans) {
        cachedSuspicious.allBans.forEach(ban => {
            const sid = String(ban.steamId);
            if (currentSteamIds.has(sid) && !db.isWhitelisted(sid)) dangerousIds.add(sid);
        });
    }
    if (cachedVac && cachedVac.allBans) {
        cachedVac.allBans.forEach(p => {
            const sid = String(p.SteamId);
            if (currentSteamIds.has(sid) && !db.isWhitelisted(sid)) dangerousIds.add(sid);
        });
    }
    if (cachedYooma && cachedYooma.allBans) {
        cachedYooma.allBans.forEach(p => {
            const sid = String(p.steamId);
            if (currentSteamIds.has(sid) && !db.isWhitelisted(sid)) dangerousIds.add(sid);
        });
    }
    const cachedCS2Red = getCachedData('cs2redBans');
    if (cachedCS2Red && cachedCS2Red.allBans) {
        cachedCS2Red.allBans.forEach(p => {
            const sid = String(p.steamId);
            if (currentSteamIds.has(sid) && !db.isWhitelisted(sid)) dangerousIds.add(sid);
        });
    }
    const cachedDeti00 = getCachedData('deti00Bans');
    if (cachedDeti00 && cachedDeti00.allBans) {
        cachedDeti00.allBans.forEach(p => {
            const sid = String(p.steamId);
            if (currentSteamIds.has(sid) && !db.isWhitelisted(sid)) dangerousIds.add(sid);
        });
    }
    const cachedPride = getCachedData('pridecs2Bans');
    if (cachedPride && cachedPride.allBans) {
        cachedPride.allBans.forEach(p => {
            const sid = String(p.steamId);
            if (currentSteamIds.has(sid) && !db.isWhitelisted(sid)) dangerousIds.add(sid);
        });
    }
    const cachedTop2 = getCachedData('top2Bans');
    if (cachedTop2 && cachedTop2.allBans) {
        cachedTop2.allBans.forEach(p => {
            const sid = String(p.steamId);
            if (currentSteamIds.has(sid) && !db.isWhitelisted(sid)) dangerousIds.add(sid);
        });
    }
    return dangerousIds.size;
}

// Функция отправки статистики (всегда отвечает, чтобы счётчики не оставались в неопределённом состоянии)
function sendStats(ws) {
    const cached = getCachedData('players');
    const cachedVac = getCachedData('vacBans');
    const cachedYooma = getCachedData('yoomaBans');
    
    let totalPlayers = 0;
    let totalAdmins = 0;
        let vacCount = 0;
        let yoomaCount = 0;
        let suspiciousCount = 0;
        
    let currentSteamIds = new Set();
    if (cached) {
        const onlineContext = buildOnlinePlayersContext(cached);
        totalPlayers = onlineContext.totalPlayers;
        totalAdmins = onlineContext.totalAdmins;
        currentSteamIds = onlineContext.steamIds;
    }
    if (cachedVac && cachedVac.allBans && currentSteamIds.size > 0) {
        vacCount = cachedVac.allBans.filter(p => currentSteamIds.has(String(p.SteamId)) && !db.isWhitelisted(String(p.SteamId))).length;
    }
    if (cachedYooma && cachedYooma.allBans && currentSteamIds.size > 0) {
        yoomaCount = cachedYooma.allBans.filter(p => currentSteamIds.has(String(p.steamId)) && !db.isWhitelisted(String(p.steamId))).length;
    }
    suspiciousCount = getDangerousCount(currentSteamIds);
        
        const stats = {
            type: 'stats',
            totalPlayers,
            totalAdmins,
            categories: {
                vac: vacCount,
                yooma: yoomaCount,
                suspicious: suspiciousCount,
            nicknames: 0
            }
        };
        
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(stats));
    }
}

// Функция отправки VAC банов
function sendVACBans(ws) {
    const cached = getCachedData('players');
    const cachedVac = getCachedData('vacBans');
    
    if (cached && cachedVac && cachedVac.allBans) {
        const { steamIds: currentSteamIds, playerDataMap } = buildOnlinePlayersContext(cached);
        const filteredPlayers = cachedVac.allBans.filter(p => 
            currentSteamIds.has(String(p.SteamId)) && !db.isWhitelisted(String(p.SteamId))
        );
        const withNames = filteredPlayers.map(p => {
            const sid = String(p.SteamId);
            const data = playerDataMap.get(sid);
            return {
                ...p,
                SteamId: sid,
                nickname: data ? data.nickname : (p.nickname || 'Unknown'),
                avatar: data ? data.avatar : (p.avatar || 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg')
            };
        });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'vac_bans', players: withNames }));
        }
    } else if (!cachedVac || !cachedVac.allBans) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'vac_bans', players: [], loading: true }));
        }
    } else {
        // Есть кэш VAC, но нет списка игроков (кэш истёк) — не затираем список на клиенте, шлём loading
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'vac_bans', players: [], loading: true }));
        }
    }
}

// Функция отправки Yooma банов
function sendYoomaBans(ws, userLevel) {
    userLevel = userLevel || 0;
    const cached = getCachedData('players');
    const cachedYooma = getCachedData('yoomaBans');
    
    if (cached && cachedYooma && cachedYooma.allBans) {
        const currentSteamIds = buildOnlinePlayersContext(cached).steamIds;
        let filteredPlayers = cachedYooma.allBans.filter(p =>
            currentSteamIds.has(String(p.steamId)) && !db.isWhitelisted(String(p.steamId))
        );
        // Уровни 1-2: скрываем баны за читы
        if (userLevel < USER_LEVEL_WHITELIST) {
            const cheatPatterns = /чит|cheat|haron anti-cheat|использование читов/i;
            filteredPlayers = filteredPlayers.filter(p => !cheatPatterns.test(p.reason || ''));
        }
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'yooma_bans', players: filteredPlayers }));
        }
    } else if (!cachedYooma || !cachedYooma.allBans) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'yooma_bans', players: [], loading: true }));
        }
    } else {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'yooma_bans', players: [], loading: true }));
        }
    }
}

// Опасные (DXDCS + VAC + Yooma): только кто сейчас на Fear; остаются в таблице, пока не выйдут
function sendSuspiciousBans(ws, userLevel) {
    userLevel = userLevel || 0;
    const cached = getCachedData('players');
    const cachedSuspicious = getCachedData('suspiciousBans');
    const cachedVac = getCachedData('vacBans');
    const cachedYooma = getCachedData('yoomaBans');
    if (!cached) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'suspicious_bans', players: [], loading: true }));
        }
        return;
    }
    const { steamIds: currentSteamIds, playerDataMap } = buildOnlinePlayersContext(cached);
    const defaultAvatar = 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg';
        const dangerousPlayers = [];
        
        if (cachedSuspicious && cachedSuspicious.allBans) {
            cachedSuspicious.allBans.forEach(ban => {
            const sid = String(ban.steamId);
            if (!currentSteamIds.has(sid) || db.isWhitelisted(sid)) return;
            const playerData = playerDataMap.get(sid);
                    dangerousPlayers.push({
                        ...ban,
                        kills: playerData ? playerData.kills : 0,
                        deaths: playerData ? playerData.deaths : 0,
                        serverName: playerData ? playerData.serverName : 'Unknown',
                        serverGame: playerData ? playerData.serverGame : null,
                        serverIp: playerData ? playerData.serverIp : null,
                        serverPort: playerData ? playerData.serverPort : null,
                        hasDXDCS: true,
                hasVAC: false,
                hasYooma: false
                    });
            });
        }
        
        if (cachedVac && cachedVac.allBans) {
            cachedVac.allBans.forEach(vacBan => {
            const sid = String(vacBan.SteamId);
            if (!currentSteamIds.has(sid) || db.isWhitelisted(sid)) return;
            const playerData = playerDataMap.get(sid);
            const existingPlayer = dangerousPlayers.find(p => String(p.steamId) === sid);
                    if (existingPlayer) {
                        existingPlayer.hasVAC = true;
                        existingPlayer.vacBans = vacBan.NumberOfGameBans;
                        existingPlayer.daysSinceLastBan = vacBan.DaysSinceLastBan;
                    } else {
                        dangerousPlayers.push({
                            steamId: vacBan.SteamId,
                            nickname: playerData ? playerData.nickname : 'Unknown',
                    avatar: playerData ? playerData.avatar : defaultAvatar,
                            reason: 'VAC',
                            adminName: 'Steam',
                            isPermanent: true,
                            kills: playerData ? playerData.kills : 0,
                            deaths: playerData ? playerData.deaths : 0,
                            serverName: playerData ? playerData.serverName : 'Unknown',
                            serverGame: playerData ? playerData.serverGame : null,
                            serverIp: playerData ? playerData.serverIp : null,
                            serverPort: playerData ? playerData.serverPort : null,
                            hasDXDCS: false,
                            hasVAC: true,
                    hasYooma: false,
                            vacBans: vacBan.NumberOfGameBans,
                            daysSinceLastBan: vacBan.DaysSinceLastBan
                        });
                    }
        });
    }
    
    if (cachedYooma && cachedYooma.allBans) {
        const cheatPatterns = /чит|cheat|haron anti-cheat|использование читов/i;
        cachedYooma.allBans.forEach(yoomaBan => {
            const sid = String(yoomaBan.steamId);
            if (!currentSteamIds.has(sid) || db.isWhitelisted(sid)) return;
            // Уровни 1-2: скрываем Yooma баны за читы из опасных
            if (userLevel < USER_LEVEL_WHITELIST && cheatPatterns.test(yoomaBan.reason || '')) return;
            const playerData = playerDataMap.get(sid);
            const existingPlayer = dangerousPlayers.find(p => String(p.steamId) === sid);
            if (existingPlayer) {
                existingPlayer.hasYooma = true;
                existingPlayer.yoomaReason = yoomaBan.reason || 'Yooma';
            } else {
                dangerousPlayers.push({
                    steamId: yoomaBan.steamId,
                    nickname: yoomaBan.nickname || (playerData ? playerData.nickname : 'Unknown'),
                    avatar: yoomaBan.avatar || (playerData ? playerData.avatar : defaultAvatar),
                    reason: yoomaBan.reason || 'Yooma',
                    created: yoomaBan.created,
                    kills: playerData ? playerData.kills : 0,
                    deaths: playerData ? playerData.deaths : 0,
                    serverName: playerData ? playerData.serverName : 'Unknown',
                    serverGame: playerData ? playerData.serverGame : null,
                    serverIp: playerData ? playerData.serverIp : null,
                    serverPort: playerData ? playerData.serverPort : null,
                    hasDXDCS: false,
                    hasVAC: false,
                    hasYooma: true,
                    yoomaReason: yoomaBan.reason || 'Yooma'
                });
                }
            });
        }
        
    const cachedCS2Red = getCachedData('cs2redBans');
    if (cachedCS2Red && cachedCS2Red.allBans) {
        cachedCS2Red.allBans.forEach(cr => {
            const sid = String(cr.steamId);
            if (!currentSteamIds.has(sid) || db.isWhitelisted(sid)) return;
            const playerData = playerDataMap.get(sid);
            const existingPlayer = dangerousPlayers.find(p => String(p.steamId) === sid);
            if (existingPlayer) {
                existingPlayer.hasCS2Red = true;
                existingPlayer.cs2redReason = cr.reason || 'CS2Red';
            } else {
                dangerousPlayers.push({
                    steamId: cr.steamId,
                    nickname: cr.nickname || (playerData ? playerData.nickname : 'Unknown'),
                    avatar: cr.avatar || (playerData ? playerData.avatar : defaultAvatar),
                    reason: cr.reason || 'CS2Red',
                    kills: playerData ? playerData.kills : 0,
                    deaths: playerData ? playerData.deaths : 0,
                    serverName: playerData ? playerData.serverName : 'Unknown',
                    serverGame: playerData ? playerData.serverGame : null,
                    serverIp: playerData ? playerData.serverIp : null,
                    serverPort: playerData ? playerData.serverPort : null,
                    hasDXDCS: false,
                    hasVAC: false,
                    hasYooma: false,
                    hasCS2Red: true,
                    cs2redReason: cr.reason || 'CS2Red'
                });
            }
        });
    }

    const cachedDeti00 = getCachedData('deti00Bans');
    if (cachedDeti00 && cachedDeti00.allBans) {
        cachedDeti00.allBans.forEach(d00 => {
            const sid = String(d00.steamId);
            if (!currentSteamIds.has(sid) || db.isWhitelisted(sid)) return;
            const playerData = playerDataMap.get(sid);
            const existingPlayer = dangerousPlayers.find(p => String(p.steamId) === sid);
            if (existingPlayer) {
                existingPlayer.hasDeti00 = true;
                existingPlayer.deti00Reason = d00.reason || 'Deti00';
    } else {
                dangerousPlayers.push({
                    steamId: d00.steamId,
                    nickname: d00.nickname || (playerData ? playerData.nickname : 'Unknown'),
                    avatar: d00.avatar || (playerData ? playerData.avatar : defaultAvatar),
                    reason: d00.reason || 'Deti00',
                    kills: playerData ? playerData.kills : 0,
                    deaths: playerData ? playerData.deaths : 0,
                    serverName: playerData ? playerData.serverName : 'Unknown',
                    serverGame: playerData ? playerData.serverGame : null,
                    serverIp: playerData ? playerData.serverIp : null,
                    serverPort: playerData ? playerData.serverPort : null,
                    hasDXDCS: false,
                    hasVAC: false,
                    hasYooma: false,
                    hasCS2Red: false,
                    hasDeti00: true,
                    deti00Reason: d00.reason || 'Deti00'
                });
            }
        });
    }

    const cachedPride = getCachedData('pridecs2Bans');
    if (cachedPride && cachedPride.allBans) {
        cachedPride.allBans.forEach(pb => {
            const sid = String(pb.steamId);
            if (!currentSteamIds.has(sid) || db.isWhitelisted(sid)) return;
            const playerData = playerDataMap.get(sid);
            const existingPlayer = dangerousPlayers.find(p => String(p.steamId) === sid);
            if (existingPlayer) {
                existingPlayer.hasPrideCS2 = true;
                existingPlayer.pridecs2Reason = pb.reason || 'PrideCS2';
            } else {
                dangerousPlayers.push({
                    steamId: pb.steamId,
                    nickname: pb.nickname || (playerData ? playerData.nickname : 'Unknown'),
                    avatar: pb.avatar || (playerData ? playerData.avatar : defaultAvatar),
                    reason: pb.reason || 'PrideCS2',
                    kills: playerData ? playerData.kills : 0,
                    deaths: playerData ? playerData.deaths : 0,
                    serverName: playerData ? playerData.serverName : 'Unknown',
                    serverGame: playerData ? playerData.serverGame : null,
                    serverIp: playerData ? playerData.serverIp : null,
                    serverPort: playerData ? playerData.serverPort : null,
                    hasDXDCS: false,
                    hasVAC: false,
                    hasYooma: false,
                    hasCS2Red: false,
                    hasDeti00: false,
                    hasPrideCS2: true,
                    pridecs2Reason: pb.reason || 'PrideCS2'
                });
            }
        });
    }

    const cachedTop2 = getCachedData('top2Bans');
    if (cachedTop2 && cachedTop2.allBans) {
        cachedTop2.allBans.forEach(t2 => {
            const sid = String(t2.steamId);
            if (!currentSteamIds.has(sid) || db.isWhitelisted(sid)) return;
            const playerData = playerDataMap.get(sid);
            const existingPlayer = dangerousPlayers.find(p => String(p.steamId) === sid);
            if (existingPlayer) {
                existingPlayer.hasTop2 = true;
                existingPlayer.top2Reason = t2.reason || 'Top2';
            } else {
                dangerousPlayers.push({
                    steamId: t2.steamId,
                    nickname: t2.nickname || (playerData ? playerData.nickname : 'Unknown'),
                    avatar: t2.avatar || (playerData ? playerData.avatar : defaultAvatar),
                    reason: t2.reason || 'Top2',
                    kills: playerData ? playerData.kills : 0,
                    deaths: playerData ? playerData.deaths : 0,
                    serverName: playerData ? playerData.serverName : 'Unknown',
                    serverGame: playerData ? playerData.serverGame : null,
                    serverIp: playerData ? playerData.serverIp : null,
                    serverPort: playerData ? playerData.serverPort : null,
                    hasDXDCS: false, hasVAC: false, hasYooma: false, hasCS2Red: false, hasDeti00: false, hasPrideCS2: false,
                    hasTop2: true,
                    top2Reason: t2.reason || 'Top2'
                });
            }
        });
    }

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'suspicious_bans', players: dangerousPlayers }));
    }
}

function sendAllPlayers(ws) {
    const cached = getCachedData('players');
    const defaultAvatar = 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg';
    if (!cached) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'all_players', players: [], loading: true }));
        }
        return;
    }
    const { steamIds, playerDataMap } = buildOnlinePlayersContext(cached);
    const players = Array.from(steamIds).map(steamId => {
        const d = playerDataMap.get(steamId);
        const wl = db.isWhitelisted(steamId);
        const wlEntry = wl ? db.getWhitelistEntry(steamId) : null;
        return {
            steamId,
            nickname: d ? d.nickname : 'Unknown',
            avatar: d ? d.avatar : defaultAvatar,
            kills: d ? d.kills : 0,
            deaths: d ? d.deaths : 0,
            serverName: d ? d.serverName : 'Unknown',
            serverGame: d ? d.serverGame : null,
            serverIp: d ? d.serverIp : null,
            serverPort: d ? d.serverPort : null,
            whitelisted: wl,
            whitelistAddedBy: wlEntry ? wlEntry.added_by_discord_id : null
        };
    }).filter(p => !p.whitelisted);
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'all_players', players, loading: false }));
    }
}

function sendFaceitLevels(ws) {
    const cached = getCachedData('players');
    if (!cached) return;
    const { steamIds: currentSteamIds } = buildOnlinePlayersContext(cached);
    const levels = {};
    for (const sid of currentSteamIds) {
        const fl = cache.faceitLevels.get(sid);
        if (fl) {
            levels[sid] = { level: fl.level, elo: fl.elo, url: fl.url };
        }
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'faceit_levels', levels }));
    }
}

// Функция отправки игр игрока
function sendPlayerGames(ws, steamId) {
    const cacheKey = `games_${steamId}`;
    if (cache.playerGames.has(cacheKey)) {
        const cached = cache.playerGames.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'player_games',
                    steamId: steamId,
                    games: cached.data.games
                }));
            }
            return;
        }
    }
    
    getPlayerGames(steamId, (err, games) => {
        if (err) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'player_games',
                    steamId: steamId,
                    games: [],
                    error: err.message
                }));
            }
            return;
        }
        
        const gameBanGamesMap = {
            730: 'Counter-Strike 2',
            440: 'Team Fortress 2',
            570: 'Dota 2',
            578080: 'PUBG: BATTLEGROUNDS',
            252490: 'Rust',
            304930: 'Unturned',
            221100: 'DayZ',
            346110: 'ARK: Survival Evolved',
            4000: "Garry's Mod",
            359550: 'Rainbow Six Siege',
            271590: 'Grand Theft Auto V',
            1172470: 'Apex Legends',
            1938090: 'Call of Duty',
            813780: 'Age of Empires II: Definitive Edition',
            1599340: 'Halo Infinite',
            1517290: 'Battlefield 2042',
            2519060: 'Overwatch 2'
        };
        
        const userBanGames = games
            .filter(game => gameBanGamesMap[game.appid])
            .map(game => ({
                appid: game.appid,
                name: game.name || gameBanGamesMap[game.appid]
            }));
        
        const result = { games: userBanGames };
        
        cache.playerGames.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        if (cache.playerGames.size > 1000) {
            const firstKey = cache.playerGames.keys().next().value;
            cache.playerGames.delete(firstKey);
        }
        
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'player_games',
                steamId: steamId,
                games: userBanGames
            }));
        }
    });
}

// Функция для broadcast обновлений всем подключенным клиентам
function broadcastUpdate(type, data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, ...data }));
        }
    });
}

function createBackgroundJobsForCycle(cycleNo, dataForChecks) {
    const criticalJobs = [
        () => timedJob('vac', () => updateVACBansInBackground(dataForChecks)),
        () => timedJob('yooma', () => updateYoomaBansInBackground(dataForChecks)),
        () => timedJob('suspicious', () => updateSuspiciousBansInBackground(dataForChecks))
    ];
    const heavyJobs = [
        () => timedJob('cs2red', () => updateCS2RedBansInBackground(dataForChecks)),
        () => timedJob('deti00', () => updateDeti00BansInBackground(dataForChecks)),
        () => timedJob('pridecs2', () => updatePrideCS2BansInBackground(dataForChecks)),
        () => timedJob('top2', () => updateTop2BansInBackground(dataForChecks)),
        () => timedJob('faceit', () => updateFaceitLevelsInBackground(dataForChecks))
    ];

    if (!RAILWAY_LIGHT_MODE) return [...criticalJobs, ...heavyJobs];
    const shouldRunHeavy = cycleNo % 3 === 0;
    return shouldRunHeavy ? [...criticalJobs, ...heavyJobs] : criticalJobs;
}

function scheduleBackgroundJobs(cycleNo, dataForChecks) {
    const jobs = createBackgroundJobsForCycle(cycleNo, dataForChecks);
    if (!jobs.length) return;
    jobs.forEach((job, idx) => {
        setTimeout(() => {
            try {
                const ret = job();
                if (ret && typeof ret.catch === 'function') {
                    ret.catch((err) => console.error('[Background] Ошибка job:', err?.message || err));
                }
            } catch (err) {
                console.error('[Background] Ошибка job:', err?.message || err);
            }
        }, idx * BG_STAGGER_MS);
    });
    const releaseAfterMs = (jobs.length * BG_STAGGER_MS) + 1500;
    setTimeout(() => {
        backgroundState.cycleRunning = false;
    }, releaseAfterMs);
}

// Функция для фоновой загрузки данных
function updateDataInBackground() {
    if (backgroundState.cycleRunning) {
        console.log('[Background] Предыдущий цикл еще активен, пропускаем overlap');
        return;
    }
    backgroundState.cycleRunning = true;
    backgroundState.cycleStartedAt = nowMs();
    backgroundState.cycleNo += 1;
    const currentCycle = backgroundState.cycleNo;
    console.log(`[Background] Обновление данных (cycle=${currentCycle}, light=${RAILWAY_LIGHT_MODE})...`);
    
    // Обновляем данные игроков ОДИН РАЗ
    fetchFearServers((err, servers) => {
        if (err) {
            backgroundState.cycleRunning = false;
            console.error('[Background] Ошибка загрузки данных игроков:', err);
            return;
        }

        // Не перезаписываем кэш пустым/невалидным ответом — после 5 мин API может временно вернуть пусто
        const prev = getCachedData('players');
        const ctx = buildOnlinePlayersContext(Array.isArray(servers) ? servers : []);
        const hasValidData = ctx.totalPlayers > 0;
        if (hasValidData) {
            try {
                const serverData = Array.isArray(servers) ? servers.map(s => ({ name: s.name || s.hostname, players: (s.players || []).length })) : [];
                db.saveServerActivity(ctx.totalPlayers, ctx.totalAdmins, serverData);
            } catch (_) {}
        }
        if (hasValidData || !prev) {
            setCachedData('players', servers);
            console.log('[Background] Данные игроков обновлены');
        } else {
            console.log('[Background] Ответ без игроков — кэш не трогаем, используем старые данные');
        }
                
        // Всегда шлём клиентам обновление (они возьмут данные из кэша)
        broadcastUpdate('stats_update', {});
        broadcastUpdate('vac_bans_update', {});
        broadcastUpdate('yooma_bans_update', {});
        broadcastUpdate('suspicious_bans_update', {});
                
        const dataForChecks = hasValidData ? servers : (prev || servers);
        console.log('[Background] Запуск проверок банов (staggered)...');
        scheduleBackgroundJobs(currentCycle, dataForChecks);
    });
}

// Функция для фоновой загрузки VAC банов
function updateVACBansInBackground(servers) {
    console.log('[Background] Обновление VAC банов...');
    
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;
    const playerDataMap = onlineContext.playerDataMap;
    
    if (steamIds.size === 0) {
        console.log('[Background] Нет Steam ID для проверки VAC. Повторная попытка через 20 секунд...');
        setTimeout(() => {
            // Используем кешированные данные вместо нового запроса к API
            const cachedPlayers = getCachedData('players');
            if (cachedPlayers) {
                updateVACBansInBackground(cachedPlayers);
            } else {
                console.log('[Background] Нет кешированных данных игроков для VAC');
            }
        }, 20000);
        return;
    }
    
    // Фильтруем уже проверенных игроков (проверенных менее 30 минут назад)
    const now = Date.now();
    const steamIdArray = Array.from(steamIds).filter(steamId => {
        const lastCheck = checkedPlayers.vac.get(steamId);
        if (lastCheck && (now - lastCheck) < CHECK_CACHE_TTL) {
            return false; // Пропускаем, уже проверяли недавно
        }
        return true;
    });
    
    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (VAC)');
        broadcastUpdate('vac_bans_update', {});
        return;
    }
    
    console.log(`[Background] Проверка VAC: ${steamIdArray.length} новых игроков (пропущено ${steamIds.size - steamIdArray.length} уже проверенных)`);
    
    const batches = [];
    for (let i = 0; i < steamIdArray.length; i += 100) {
        batches.push(steamIdArray.slice(i, i + 100));
    }
    
    console.log(`[Background] Всего Steam ID: ${steamIdArray.length}, батчей: ${batches.length}`);
    
    let allBanData = [];
    
    const processBatch = (batchIndex) => {
        if (batchIndex >= batches.length) {
            steamIdArray.forEach(steamId => {
                checkedPlayers.vac.set(steamId, Date.now());
            });
            
            const newBanned = allBanData
                .filter(p => p.NumberOfGameBans && parseInt(p.NumberOfGameBans) > 0);

            // Мержим с существующим кэшем: оставляем ранее найденных + добавляем новых
            const existing = getCachedData('vacBans');
            const existingBans = (existing && existing.allBans) ? existing.allBans : [];
            const checkedSet = new Set(steamIdArray.map(String));
            const kept = existingBans.filter(p => !checkedSet.has(String(p.SteamId)));
            const merged = [...kept, ...newBanned].sort((a, b) => a.DaysSinceLastBan - b.DaysSinceLastBan);
            
            console.log(`[Background] VAC баны обновлены: ${newBanned.length} новых, ${kept.length} из кэша, итого ${merged.length}`);
            
            setCachedData('vacBans', { 
                allBans: merged,
                timestamp: Date.now()
            });
            
            broadcastUpdate('vac_bans_update', {});
            return;
        }
        
        const batch = batches[batchIndex];
        
        checkVACBans(batch, (err, banData) => {
            if (!err && banData) {
                banData.forEach(player => {
                    const playerInfo = playerDataMap.get(String(player.SteamId));
                    if (playerInfo) {
                        player.nickname = playerInfo.nickname;
                        player.avatar = playerInfo.avatar;
                    }
                });
                allBanData = allBanData.concat(banData);
            } else if (err) {
                console.error(`[Background] Ошибка в батче ${batchIndex + 1}:`, err);
            }
            
            setTimeout(() => {
                processBatch(batchIndex + 1);
            }, 1000);
        });
    };
    
    processBatch(0);
}

// Функция для фоновой загрузки Yooma банов
function updateYoomaBansInBackground(servers) {
    // Проверяем, не идет ли уже проверка
    if (ongoingChecks.yooma) {
        console.log('[Background] Yooma проверка уже выполняется, пропускаем...');
        return;
    }
    
    console.log('[Background] Обновление Yooma банов...');
    ongoingChecks.yooma = true;
    
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;
    const playerDataMap = onlineContext.playerDataMap;
    
    if (steamIds.size === 0) {
        console.log('[Background] Нет Steam ID для проверки Yooma. Повторная попытка через 20 секунд...');
        ongoingChecks.yooma = false;
        setTimeout(() => {
            // Используем кешированные данные вместо нового запроса к API
            const cachedPlayers = getCachedData('players');
            if (cachedPlayers) {
                updateYoomaBansInBackground(cachedPlayers);
            } else {
                console.log('[Background] Нет кешированных данных игроков для Yooma');
            }
        }, 20000);
        return;
    }
    
    // Фильтруем уже проверенных игроков
    const now = Date.now();
    const steamIdArray = Array.from(steamIds).filter(steamId => {
        const lastCheck = checkedPlayers.yooma.get(steamId);
        if (lastCheck && (now - lastCheck) < CHECK_CACHE_TTL) {
            return false;
        }
        return true;
    });
    
    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (Yooma)');
        ongoingChecks.yooma = false;
        broadcastUpdate('yooma_bans_update', {});
        return;
    }
    
    console.log(`[Background] Проверка Yooma: ${steamIdArray.length} новых игроков (пропущено ${steamIds.size - steamIdArray.length} уже проверенных)`);
    
    checkYoomaBans(
        steamIdArray, 
        playerDataMap,
        // Progress callback
        (progress) => {
            console.log(`[Background] Yooma прогресс: ${progress.processed}/${progress.total}, найдено: ${progress.found}`);
            // Не перезаписываем кэш частичными данными — только в final callback
        },
        (err, bannedPlayers) => {
            ongoingChecks.yooma = false;
            
            if (err) {
                console.error('[Background] Ошибка проверки Yooma банов:', err);
                return;
            }
            
            steamIdArray.forEach(steamId => {
                checkedPlayers.yooma.set(steamId, Date.now());
            });
            
            // Мержим с существующим кэшем
            const existing = getCachedData('yoomaBans');
            const existingBans = (existing && existing.allBans) ? existing.allBans : [];
            const checkedSet = new Set(steamIdArray.map(String));
            const kept = existingBans.filter(p => !checkedSet.has(String(p.steamId)));
            const merged = [...kept, ...bannedPlayers];
            
            console.log(`[Background] Yooma баны обновлены: ${bannedPlayers.length} новых, ${kept.length} из кэша, итого ${merged.length}`);
            setCachedData('yoomaBans', { 
                allBans: merged,
                timestamp: Date.now()
            });
            broadcastUpdate('yooma_bans_update', {});
        }
    );
}


// Функция для фоновой загрузки опасных игроков
function updateSuspiciousBansInBackground(servers) {
    // Проверяем, не идет ли уже проверка
    if (ongoingChecks.suspicious) {
        console.log('[Background] Suspicious проверка уже выполняется, пропускаем...');
        return;
    }
    
    console.log('[Background] Обновление опасных игроков...');
    ongoingChecks.suspicious = true;
    
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;
    const playerDataMap = onlineContext.playerDataMap;
    
    if (steamIds.size === 0) {
        console.log('[Background] Нет Steam ID для проверки опасных. Повторная попытка через 20 секунд...');
        ongoingChecks.suspicious = false;
        setTimeout(() => {
            // Используем кешированные данные вместо нового запроса к API
            const cachedPlayers = getCachedData('players');
            if (cachedPlayers) {
                updateSuspiciousBansInBackground(cachedPlayers);
            } else {
                console.log('[Background] Нет кешированных данных игроков для Suspicious');
            }
        }, 20000);
        return;
    }
    
    // Фильтруем уже проверенных игроков
    const now = Date.now();
    const steamIdArray = Array.from(steamIds).filter(steamId => {
        const lastCheck = checkedPlayers.suspicious.get(steamId);
        if (lastCheck && (now - lastCheck) < CHECK_CACHE_TTL) {
            return false;
        }
        return true;
    });
    
    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (Suspicious)');
        ongoingChecks.suspicious = false;
        broadcastUpdate('suspicious_bans_update', {});
        return;
    }
    
    console.log(`[Background] Проверка Suspicious: ${steamIdArray.length} новых игроков (пропущено ${steamIds.size - steamIdArray.length} уже проверенных)`);
    
    checkSuspiciousBans(
        steamIdArray, 
        playerDataMap,
        // Progress callback - вызывается после каждого батча
        (progress) => {
            console.log(`[Background] Suspicious прогресс: ${progress.processed}/${progress.total}, найдено: ${progress.found}`);
            // Не перезаписываем кэш частичными данными — только в final callback
        },
        (err, suspiciousPlayers) => {
            ongoingChecks.suspicious = false;
            
            if (err) {
                console.error('[Background] Ошибка проверки опасных игроков:', err);
                return;
            }
            
            steamIdArray.forEach(steamId => {
                checkedPlayers.suspicious.set(steamId, Date.now());
            });
            
            // Мержим с существующим кэшем
            const existing = getCachedData('suspiciousBans');
            const existingBans = (existing && existing.allBans) ? existing.allBans : [];
            const checkedSet = new Set(steamIdArray.map(String));
            const kept = existingBans.filter(p => !checkedSet.has(String(p.steamId)));
            const merged = [...kept, ...suspiciousPlayers];
            
            console.log(`[Background] Опасные игроки обновлены: ${suspiciousPlayers.length} новых, ${kept.length} из кэша, итого ${merged.length}`);
            setCachedData('suspiciousBans', { 
                allBans: merged,
                timestamp: Date.now()
            });
            
            broadcastUpdate('suspicious_bans_update', {});
        }
    );
}

async function updateCS2RedBansInBackground(servers) {
    console.log('[Background] Обновление CS2Red банов...');
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;
    const playerDataMap = onlineContext.playerDataMap;

    if (!steamIds || steamIds.size === 0) {
        setTimeout(() => {
            const cachedPlayers = getCachedData('players');
            if (cachedPlayers) updateCS2RedBansInBackground(cachedPlayers);
        }, 20000);
        return;
    }

    const steamIdArray = [...steamIds].filter(sid => {
        const last = checkedPlayers.cs2red.get(sid);
        if (last && (Date.now() - last) < CHECK_CACHE_TTL) return false;
        return true;
    });

    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (CS2Red)');
        broadcastUpdate('suspicious_bans_update', {});
        return;
    }

    console.log(`[Background] Проверка CS2Red: ${steamIdArray.length} новых игроков`);
    try {
        const bannedPlayers = await checkCS2RedBans(steamIdArray, playerDataMap);
        steamIdArray.forEach(sid => checkedPlayers.cs2red.set(sid, Date.now()));

        const existing = getCachedData('cs2redBans');
        const existingBans = (existing && existing.allBans) ? existing.allBans : [];
        const checkedSet = new Set(steamIdArray.map(String));
        const kept = existingBans.filter(p => !checkedSet.has(String(p.steamId)));
        const merged = [...kept, ...bannedPlayers];

        console.log(`[Background] CS2Red обновлены: ${bannedPlayers.length} новых, ${kept.length} из кэша, итого ${merged.length}`);
        setCachedData('cs2redBans', { allBans: merged, timestamp: Date.now() });
        broadcastUpdate('suspicious_bans_update', {});
    } catch (err) {
        console.error('[Background] Ошибка CS2Red:', err.message);
    }
}

async function updateDeti00BansInBackground(servers) {
    console.log('[Background] Обновление Deti00 банов...');
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;
    const playerDataMap = onlineContext.playerDataMap;

    if (!steamIds || steamIds.size === 0) {
        setTimeout(() => {
            const cachedPlayers = getCachedData('players');
            if (cachedPlayers) updateDeti00BansInBackground(cachedPlayers);
        }, 20000);
        return;
    }

    const steamIdArray = [...steamIds].filter(sid => {
        const last = checkedPlayers.deti00.get(sid);
        if (last && (Date.now() - last) < CHECK_CACHE_TTL) return false;
        return true;
    });

    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (Deti00)');
        broadcastUpdate('suspicious_bans_update', {});
        return;
    }

    console.log(`[Background] Проверка Deti00: ${steamIdArray.length} новых игроков`);
    try {
        const bannedPlayers = await checkDeti00Bans(steamIdArray, playerDataMap);
        steamIdArray.forEach(sid => checkedPlayers.deti00.set(sid, Date.now()));

        const existing = getCachedData('deti00Bans');
        const existingBans = (existing && existing.allBans) ? existing.allBans : [];
        const checkedSet = new Set(steamIdArray.map(String));
        const kept = existingBans.filter(p => !checkedSet.has(String(p.steamId)));
        const merged = [...kept, ...bannedPlayers];

        console.log(`[Background] Deti00 обновлены: ${bannedPlayers.length} новых, ${kept.length} из кэша, итого ${merged.length}`);
        setCachedData('deti00Bans', { allBans: merged, timestamp: Date.now() });
        broadcastUpdate('suspicious_bans_update', {});
    } catch (err) {
        console.error('[Background] Ошибка Deti00:', err.message);
    }
}

async function updatePrideCS2BansInBackground(servers) {
    console.log('[Background] Обновление PrideCS2 банов...');
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;
    const playerDataMap = onlineContext.playerDataMap;

    if (!steamIds || steamIds.size === 0) {
        setTimeout(() => {
            const cachedPlayers = getCachedData('players');
            if (cachedPlayers) updatePrideCS2BansInBackground(cachedPlayers);
        }, 20000);
        return;
    }

    const steamIdArray = [...steamIds].filter(sid => {
        const last = checkedPlayers.pridecs2.get(sid);
        if (last && (Date.now() - last) < CHECK_CACHE_TTL) return false;
        return true;
    });

    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (PrideCS2)');
        broadcastUpdate('suspicious_bans_update', {});
        return;
    }

    console.log(`[Background] Проверка PrideCS2: ${steamIdArray.length} новых игроков`);
    try {
        const bannedPlayers = await checkPrideCS2Bans(steamIdArray, playerDataMap);
        steamIdArray.forEach(sid => checkedPlayers.pridecs2.set(sid, Date.now()));

        const existing = getCachedData('pridecs2Bans');
        const existingBans = (existing && existing.allBans) ? existing.allBans : [];
        const checkedSet = new Set(steamIdArray.map(String));
        const kept = existingBans.filter(p => !checkedSet.has(String(p.steamId)));
        const merged = [...kept, ...bannedPlayers];

        console.log(`[Background] PrideCS2 обновлены: ${bannedPlayers.length} новых, ${kept.length} из кэша, итого ${merged.length}`);
        setCachedData('pridecs2Bans', { allBans: merged, timestamp: Date.now() });
        broadcastUpdate('suspicious_bans_update', {});
    } catch (err) {
        console.error('[Background] Ошибка PrideCS2:', err.message);
    }
}

async function updateTop2BansInBackground(servers) {
    console.log('[Background] Обновление Top2 банов...');
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;
    const playerDataMap = onlineContext.playerDataMap;

    if (!steamIds || steamIds.size === 0) {
        setTimeout(() => {
            const cachedPlayers = getCachedData('players');
            if (cachedPlayers) updateTop2BansInBackground(cachedPlayers);
        }, 20000);
        return;
    }

    const steamIdArray = [...steamIds].filter(sid => {
        const last = checkedPlayers.top2.get(sid);
        if (last && (Date.now() - last) < CHECK_CACHE_TTL) return false;
        return true;
    });

    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (Top2)');
        broadcastUpdate('suspicious_bans_update', {});
        return;
    }

    console.log(`[Background] Проверка Top2: ${steamIdArray.length} новых игроков`);
    try {
        const bannedPlayers = await checkTop2Bans(steamIdArray, playerDataMap);
        steamIdArray.forEach(sid => checkedPlayers.top2.set(sid, Date.now()));

        const existing = getCachedData('top2Bans');
        const existingBans = (existing && existing.allBans) ? existing.allBans : [];
        const checkedSet = new Set(steamIdArray.map(String));
        const kept = existingBans.filter(p => !checkedSet.has(String(p.steamId)));
        const merged = [...kept, ...bannedPlayers];

        console.log(`[Background] Top2 обновлены: ${bannedPlayers.length} новых, ${kept.length} из кэша, итого ${merged.length}`);
        setCachedData('top2Bans', { allBans: merged, timestamp: Date.now() });
        broadcastUpdate('suspicious_bans_update', {});
    } catch (err) {
        console.error('[Background] Ошибка Top2:', err.message);
    }
}

async function updateFaceitLevelsInBackground(servers) {
    if (!FACEIT_API_KEY) return;
    console.log('[Background] Обновление Faceit уровней...');
    const onlineContext = buildOnlinePlayersContext(servers);
    const steamIds = onlineContext.steamIds;

    if (steamIds.size === 0) return;

    const now = Date.now();
    const steamIdArray = [...steamIds].filter(sid => {
        const last = checkedPlayers.faceit.get(sid);
        if (last && (now - last) < CHECK_CACHE_TTL) return false;
        return true;
    });

    if (steamIdArray.length === 0) {
        console.log('[Background] Все игроки уже проверены недавно (Faceit)');
        return;
    }

    console.log(`[Background] Проверка Faceit: ${steamIdArray.length} новых игроков`);
    let checked = 0;
    let found = 0;

    for (const sid of steamIdArray) {
        try {
            const data = await new Promise((resolve) => {
                const r = https.get(`https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${sid}`, {
                    headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
                }, (apiRes) => {
                    let d = '';
                    apiRes.on('data', c => d += c);
                    apiRes.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
                });
                r.on('error', () => resolve(null));
                r.setTimeout(5000, () => { r.destroy(); resolve(null); });
            });

            checkedPlayers.faceit.set(sid, Date.now());

            if (data && data.player_id && data.games?.cs2) {
                cache.faceitLevels.set(sid, {
                    level: data.games.cs2.skill_level || 0,
                    elo: data.games.cs2.faceit_elo || 0,
                    nickname: data.nickname || null,
                    url: data.faceit_url ? data.faceit_url.replace('{lang}', 'en') : null,
                    timestamp: Date.now()
                });
                found++;
            }
            checked++;

            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
            checkedPlayers.faceit.set(sid, Date.now());
            checked++;
        }
    }

    console.log(`[Background] Faceit проверено: ${checked}, найдено: ${found}`);
    broadcastUpdate('faceit_levels_update', {});
}

