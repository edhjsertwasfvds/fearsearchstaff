const https = require('https');

const punishmentsCache = new Map(); // steamId -> { data, ts }
const PUNISHMENTS_CACHE_TTL_MS = 3 * 60 * 1000;
const PUNISHMENTS_CACHE_STALE_MS = 15 * 60 * 1000;

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

function fetchPunishmentsForSteamId(steamId) {
    if (!/^\d{5,}$/.test(steamId)) return Promise.resolve({ punishments: [] });
    const baseUrl = 'https://davidonchik.online/admin/' + encodeURIComponent(steamId);
    const fetchJson = (url) => new Promise((resolve) => {
        const r = https.get(url, (apiRes) => {
            let data = '';
            apiRes.on('data', c => data += c);
            apiRes.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        r.on('error', () => resolve(null));
        r.setTimeout(15000, () => { r.destroy(); resolve(null); });
    });
    const withTypeFallback = (arr, fallbackType) => {
        if (!Array.isArray(arr)) return [];
        return arr.map((p) => {
            const t = Number(p?.type);
            if (t === 1 || t === 2) return p;
            return { ...p, type: fallbackType };
        });
    };
    return Promise.all([
        fetchJson(baseUrl + '?type=1&limit=10000'),
        fetchJson(baseUrl + '?type=2&limit=10000')
    ]).then(([r1, r2]) => {
        const list1Raw = (r1 && r1.status === 'ok' && Array.isArray(r1.punishments)) ? r1.punishments : [];
        const list2Raw = (r2 && r2.status === 'ok' && Array.isArray(r2.punishments)) ? r2.punishments : [];
        const list1 = withTypeFallback(list1Raw, 1);
        const list2 = withTypeFallback(list2Raw, 2);
        const punishments = [...list1, ...list2].map(normalizePunishmentCreated);
        return { punishments };
    });
}

function getPunishmentsFromCache(steamId) {
    const item = punishmentsCache.get(String(steamId || ''));
    if (!item) return null;
    const age = nowMs() - item.ts;
    if (age <= PUNISHMENTS_CACHE_STALE_MS) return item.data;
    return null;
}

function getPunishmentsCacheEntry(steamId) {
    return punishmentsCache.get(String(steamId || '')) || null;
}

function setPunishmentsToCache(steamId, punishments) {
    punishmentsCache.set(String(steamId || ''), { data: Array.isArray(punishments) ? punishments : [], ts: nowMs() });
}

module.exports = {
    punishmentsCache,
    PUNISHMENTS_CACHE_TTL_MS,
    PUNISHMENTS_CACHE_STALE_MS,
    normalizePunishmentCreated,
    fetchPunishmentsForSteamId,
    getPunishmentsFromCache,
    getPunishmentsCacheEntry,
    setPunishmentsToCache
};

