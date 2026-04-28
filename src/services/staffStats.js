const fs = require('fs');
const https = require('https');

const config = require('../config');
const punishments = require('./punishments');

// Кэш стаффа и его статистики наказаний.
// - список стаффа обновляем раз в 24 часа
// - статистику наказаний по стаффу обновляем раз в час
const staffPunishmentsCache = {
    staffList: [],
    staffListLastUpdated: 0,
    dataBySteamId: {},
    lastUpdated: 0,
    loading: false,
    staffListLoading: false
};

const STAFF_JSON_PATH = config.path.join(__dirname, '..', '..', 'public', 'data', 'staff.json');
const STAFF_ADMINS_JSON_PATH = config.path.join(__dirname, '..', '..', 'public', 'data', 'staff-admins.json');
const STAFF_STATS_FETCH_CONCURRENCY = 5;
const PUNISHMENTS_DELAY_MS = 40;
const STAFF_LIST_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STAFF_STATS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function refreshStaffList() {
    if (staffPunishmentsCache.staffListLoading) return;
    staffPunishmentsCache.staffListLoading = true;

    const allowedGroupDisplayNames = new Set(['Ст. Модер', 'Модератор', 'Мл. Модератор']);
    const allowedByName = new Set(['Quasar']);

    const normalizeAdminToStaff = (a) => ({
        steamid: String(a?.steamid || ''),
        name: a?.name || '—',
        avatar_full: a?.avatar_full || '',
        group_display_name: a?.group_display_name || '',
        group_name: a?.group_name || ''
    });

    const filterAdmin = (a) => {
        const name = a?.name;
        const group = a?.group_display_name;
        return allowedByName.has(name) || allowedGroupDisplayNames.has(group);
    };

    let staffList = [];
    try {
        if (!config.FEAR_ACCESS_TOKEN) {
            const raw = fs.readFileSync(STAFF_JSON_PATH, 'utf8');
            const data = JSON.parse(raw);
            const admins = Array.isArray(data) ? data : [];
            staffList = admins.filter(filterAdmin).map(normalizeAdminToStaff);
        } else {
            const cookie = `__ddg1_=g7Ui979pOEjDNf5BOT9p; access_token=${config.FEAR_ACCESS_TOKEN}`;
            const admins = await new Promise((resolve) => {
                const req = https.get('https://api.fearproject.ru/admins/', {
                    timeout: config.REQUEST_TIMEOUT_SLOW,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                        'Origin': 'https://fearproject.ru',
                        'Referer': 'https://fearproject.ru/',
                        'Cookie': cookie
                    }
                }, (apiRes) => {
                    let data = '';
                    apiRes.on('data', c => data += c);
                    apiRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(Array.isArray(parsed) ? parsed : []);
                        } catch (_) {
                            resolve([]);
                        }
                    });
                });
                req.on('error', () => resolve([]));
                req.on('timeout', () => { try { req.destroy(); } catch {} resolve([]); });
            });

            staffList = admins.filter(filterAdmin).map(normalizeAdminToStaff);
            // Обновляем локальный staff.json раз в 24 часа, чтобы интерфейс работал у всех.
            if (staffList.length > 0) {
                try {
                    fs.writeFileSync(STAFF_JSON_PATH, JSON.stringify(staffList, null, 2), 'utf8');
                } catch (_) {}
            }
        }
    } catch (e) {
        console.warn('[Staff] Не удалось обновить staff list, используем текущий staff.json:', e.message);
        try {
            const raw = fs.readFileSync(STAFF_JSON_PATH, 'utf8');
            const data = JSON.parse(raw);
            const admins = Array.isArray(data) ? data : [];
            staffList = admins.filter(filterAdmin).map(normalizeAdminToStaff);
        } catch (_) {
            staffList = [];
        }
    }

    staffPunishmentsCache.staffList = staffList;
    staffPunishmentsCache.staffListLastUpdated = Date.now();
    staffPunishmentsCache.staffListLoading = false;
    console.log('[Staff] Обновлен staff list:', staffList.length, 'чел.');
}

async function refreshStaffPunishmentsCache() {
    if (staffPunishmentsCache.loading) return;
    staffPunishmentsCache.loading = true;
    try {
        if (!Array.isArray(staffPunishmentsCache.staffList) || staffPunishmentsCache.staffList.length === 0) {
            await refreshStaffList();
        }
        const staffList = Array.isArray(staffPunishmentsCache.staffList) ? staffPunishmentsCache.staffList.slice() : [];
        if (staffList.length === 0) {
            staffPunishmentsCache.dataBySteamId = {};
            staffPunishmentsCache.lastUpdated = Date.now();
            return;
        }

        const dataBySteamId = {};
        let cursor = 0;
        const workerCount = Math.max(1, Math.min(STAFF_STATS_FETCH_CONCURRENCY, staffList.length));
        const workers = Array.from({ length: workerCount }, async () => {
            while (true) {
                const i = cursor++;
                if (i >= staffList.length) return;
                const sid = String(staffList[i]?.steamid || '');
                if (!sid) continue;
                const fromCache = punishments.getPunishmentsFromCache(sid);
                if (Array.isArray(fromCache)) {
                    dataBySteamId[sid] = fromCache;
                    continue;
                }
                try {
                    const { punishments: list } = await punishments.fetchPunishmentsForSteamId(sid);
                    const normalizedList = Array.isArray(list) ? list : [];
                    dataBySteamId[sid] = normalizedList;
                    punishments.setPunishmentsToCache(sid, normalizedList);
                } catch (_) {
                    dataBySteamId[sid] = [];
                }
                if (PUNISHMENTS_DELAY_MS > 0) await sleep(PUNISHMENTS_DELAY_MS);
            }
        });
        await Promise.all(workers);
        staffPunishmentsCache.dataBySteamId = dataBySteamId;
        staffPunishmentsCache.lastUpdated = Date.now();
        console.log('[Staff stats] Обновлена статистика наказаний стафа:', staffList.length, 'чел.');
    } finally {
        staffPunishmentsCache.loading = false;
    }
}

function isSteamIdInStaffList(steamId) {
    const sid = String(steamId || '');
    if (!sid) return false;
    const cacheList = Array.isArray(staffPunishmentsCache.staffList) ? staffPunishmentsCache.staffList : [];
    if (cacheList.some(s => String(s?.steamid || '') === sid)) return true;
    try {
        const raw = fs.readFileSync(STAFF_JSON_PATH, 'utf8');
        const fileList = JSON.parse(raw);
        if (Array.isArray(fileList)) {
            return fileList.some(s => String(s?.steamid || '') === sid);
        }
    } catch (_) {}
    return false;
}

function isSteamIdInStaffAdmins(steamId) {
    const sid = String(steamId || '');
    if (!sid) return false;
    try {
        const raw = fs.readFileSync(STAFF_ADMINS_JSON_PATH, 'utf8');
        const fileList = JSON.parse(raw);
        if (!Array.isArray(fileList)) return false;
        return fileList.some(s => String(s?.steamid || s?.steam_id || s?.id || '') === sid);
    } catch (_) {
        return false;
    }
}

function isSteamIdStaff(steamId) {
    // В контексте доступа к наказаниям считаем "стаффом" только текущий список (`staff.json` / cache),
    // а не исторический/расширенный список (`staff-admins.json`).
    return isSteamIdInStaffList(steamId);
}

module.exports = {
    staffPunishmentsCache,
    STAFF_JSON_PATH,
    STAFF_ADMINS_JSON_PATH,
    STAFF_LIST_REFRESH_INTERVAL_MS,
    STAFF_STATS_REFRESH_INTERVAL_MS,
    refreshStaffList,
    refreshStaffPunishmentsCache,
    isSteamIdInStaffAdmins,
    isSteamIdStaff
};

