const https = require('https');

const API_BASE = 'https://api.fearproject.ru';

const punishmentsCache = new Map(); // key -> { data, ts }
const PUNISHMENTS_CACHE_TTL_MS = 3 * 60 * 1000;
const PUNISHMENTS_CACHE_STALE_MS = 15 * 60 * 1000;
const PUNISHMENTS_REQ_TIMEOUT_MS = 20000;

function nowMs() {
    return Date.now();
}

function normalizePunishmentCreated(p) {
    const raw = p.created ?? p.created_at ?? p.date ?? p.timestamp ?? p.time ?? p.punish_time ?? p.ban_time ?? p.issue_time ?? p.start_time;
    let created = null;
    if (typeof raw === 'number') created = raw > 1e12 ? Math.floor(raw / 1000) : raw;
    else if (typeof raw === 'string' && raw.trim()) {
        const trimmed = raw.trim();
        const asNum = parseInt(trimmed, 10);
        if (Number.isFinite(asNum)) created = asNum > 1e12 ? Math.floor(asNum / 1000) : asNum;
        else {
            const ms = Date.parse(trimmed.replace(' ', 'T'));
            if (!Number.isNaN(ms)) created = Math.floor(ms / 1000);
        }
    }
    return { ...p, created: created != null ? created : 0 };
}

function httpsGetJson(url, timeoutMs = 15000, retries = 2) {
    return new Promise((resolve) => {
        let attempts = 0;
        const tryFetch = () => {
            attempts++;
            const req = https.get(url, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', () => {
                if (attempts <= retries) setTimeout(tryFetch, 500 * attempts);
                else resolve(null);
            });
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                if (attempts <= retries) setTimeout(tryFetch, 500 * attempts);
                else resolve(null);
            });
        };
        tryFetch();
    });
}

function isRemoved(p) {
    if (p.unpunish_admin != null && String(p.unpunish_admin).trim() !== '') return true;
    if (p.unpunish_admin_steamid != null) {
        const s = String(p.unpunish_admin_steamid).trim();
        if (s !== '' && s !== '0') return true;
    }
    return Number(p.status) === 2;
}

function isActive(p) {
    if (isRemoved(p)) return false;
    const now = Math.floor(Date.now() / 1000);
    const expires = Number(p.expires) || 0;
    const duration = Number(p.duration) || 0;
    // Бан активен, если статус активен и срок не истёк (или перманент).
    if (Number(p.status) === 1) {
        return expires === 0 || expires > now;
    }
    if (expires === 0) return true; // permanent
    return expires > now;
}

function categorizePunishment(p) {
    return {
        ...p,
        _removed: isRemoved(p),
        _active: isActive(p),
        _expired: !isRemoved(p) && !isActive(p)
    };
}

function cacheKey(steamId, mode) {
    return `${mode || 'admin'}:${steamId}`;
}

async function fetchPunishmentsPage(q, type, page, limit) {
    const url = `${API_BASE}/punishments/search?q=${encodeURIComponent(q)}&type=${type}&page=${page}&limit=${limit}`;
    const res = await httpsGetJson(url, PUNISHMENTS_REQ_TIMEOUT_MS, 2);
    if (!res || !Array.isArray(res.punishments)) return { total: 0, punishments: [] };
    return {
        total: parseInt(res.total != null ? String(res.total) : '0', 10) || res.punishments.length,
        punishments: res.punishments.map(p => ({ ...p, _queryType: Number(type) })),
        page: res.page || page,
        limit: res.limit || limit
    };
}

async function fetchAllPunishments(q, type) {
    const limit = 100;
    let page = 1;
    const all = [];
    let total = null;
    while (true) {
        const { total: t, punishments } = await fetchPunishmentsPage(q, type, page, limit);
        if (total === null) total = t;
        all.push(...punishments);
        if (punishments.length < limit || all.length >= total) break;
        page++;
        if (page > 100) break; // safety guard
    }
    return all;
}

function fetchPunishmentsForSteamId(steamId, mode = 'admin') {
    if (!/^\d{5,}$/.test(steamId)) return Promise.resolve({ punishments: [] });
    return Promise.all([
        fetchAllPunishments(steamId, 1),
        fetchAllPunishments(steamId, 2)
    ]).then(([bans, mutes]) => {
        const all = [...bans, ...mutes];
        const target = String(steamId);
        const filtered = all.filter(p => {
            if (mode === 'player') return String(p.steamid || '') === target;
            return String(p.admin_steamid || '') === target;
        });
        const normalized = filtered.map(p => {
            const type = Number(p._queryType);
            return normalizePunishmentCreated({ ...p, type: (type === 1 || type === 2) ? type : (Number(p.type) || 0) });
        }).map(categorizePunishment);
        return { punishments: normalized };
    });
}

function getPunishmentsFromCache(steamId, mode) {
    const item = punishmentsCache.get(cacheKey(steamId, mode));
    if (!item) return null;
    const age = nowMs() - item.ts;
    if (age <= PUNISHMENTS_CACHE_STALE_MS) return item.data;
    return null;
}

function getPunishmentsCacheEntry(steamId, mode) {
    return punishmentsCache.get(cacheKey(steamId, mode)) || null;
}

function setPunishmentsToCache(steamId, mode, punishments) {
    punishmentsCache.set(cacheKey(steamId, mode), { data: Array.isArray(punishments) ? punishments : [], ts: nowMs() });
}

module.exports = {
    punishmentsCache,
    PUNISHMENTS_CACHE_TTL_MS,
    PUNISHMENTS_CACHE_STALE_MS,
    PUNISHMENTS_REQ_TIMEOUT_MS,
    normalizePunishmentCreated,
    categorizePunishment,
    fetchPunishmentsForSteamId,
    getPunishmentsFromCache,
    getPunishmentsCacheEntry,
    setPunishmentsToCache
};
