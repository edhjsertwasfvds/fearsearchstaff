const fs = require('fs');
const https = require('https');

const config = require('../config');
const punishments = require('./punishments');
const bddStaffPg = require('../bddStaffPg');

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

// Кэш Discord-аватарок стаффа: discord_id -> { avatar_url, ts }
const discordAvatarCache = new Map();
const DISCORD_AVATAR_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

function discordAvatarUrl(discordId, avatarHash) {
    if (!discordId || !avatarHash) return '';
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}?size=128`;
}

async function fetchDiscordAvatars(discordIds) {
    const token = config.DISCORD_BOT_TOKEN;
    if (!token || discordIds.length === 0) return {};
    const uniqueIds = [...new Set(discordIds.filter(Boolean))];
    const result = {};

    await Promise.all(uniqueIds.map(async (discordId) => {
        const cached = discordAvatarCache.get(discordId);
        if (cached && Date.now() - cached.ts < DISCORD_AVATAR_CACHE_TTL_MS) {
            result[discordId] = cached.avatar;
            return;
        }
        try {
            const data = await new Promise((resolve, reject) => {
                const req = https.get(`https://discord.com/api/users/${discordId}`, {
                    headers: {
                        'Authorization': `Bot ${token}`,
                        'User-Agent': 'FearSearchStaffBot/1.0'
                    },
                    timeout: 4000
                }, (res) => {
                    let body = '';
                    res.on('data', c => body += c);
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Discord API ${res.statusCode}`));
                            return;
                        }
                        try {
                            resolve(JSON.parse(body));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            });
            const avatar = discordAvatarUrl(String(data.id || discordId), data.avatar || '');
            discordAvatarCache.set(discordId, { avatar, ts: Date.now() });
            result[discordId] = avatar;
        } catch (e) {
            discordAvatarCache.set(discordId, { avatar: '', ts: Date.now() });
            result[discordId] = '';
        }
    }));

    return result;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function refreshStaffList() {
    if (staffPunishmentsCache.staffListLoading) return;
    staffPunishmentsCache.staffListLoading = true;

    // Стафф: group_id 1 (Модератор), 3 (STAFF), 5 (Ст. Модер), 6 (Мл. Модератор), 7 (Ст. Администратор), 8 (Гл. Администратор), 10 (Медиа).
    const allowedGroupIds = new Set([1, 3, 5, 6, 7, 8, 10]);
    const allowedGroupDisplayNames = new Set(['Стафф', 'Стаф', 'Ст. Модер', 'Модератор', 'Мл. Модератор', 'Ст. Администратор', 'Гл. Администратор', 'Медиа']);
    const allowedGroupNames = new Set(['STAFF', 'STMODER', 'MODER', 'MLMODER', 'STADMIN', 'GLADMIN', 'MEDIA']);

    const normalizeAdminToStaff = (a) => ({
        steamid: String(a?.steamid || ''),
        name: a?.name || '—',
        avatar_full: a?.avatar_full || '',
        group_display_name: a?.group_display_name || '',
        group_name: a?.group_name || '',
        group_id: a?.group_id ?? null,
        discord_id: a?.discord_id || '',
        discord_nickname: a?.discord_nickname || ''
    });

    const filterAdmin = (a) => {
        const gid = Number(a?.group_id);
        if (Number.isFinite(gid) && allowedGroupIds.has(gid)) return true;
        const group = String(a?.group_display_name || '').trim();
        const gn = String(a?.group_name || '').trim().toUpperCase();
        return (
            allowedGroupDisplayNames.has(group) ||
            allowedGroupNames.has(gn)
        );
    };

    let staffList = [];
    try {
        if (!config.FEAR_ACCESS_TOKEN) {
            const raw = fs.readFileSync(STAFF_JSON_PATH, 'utf8');
            const data = JSON.parse(raw);
            const admins = Array.isArray(data) ? data : [];
            staffList = admins.filter(filterAdmin).map(normalizeAdminToStaff);
        } else {
            const cookie = `access_token=${config.FEAR_ACCESS_TOKEN}`;
            const admins = await new Promise((resolve) => {
                const req = https.get('https://api.fearproject.ru/admins', {
                    timeout: config.REQUEST_TIMEOUT_SLOW,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
                        'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'Origin': 'https://fearproject.ru',
                        'Referer': 'https://fearproject.ru/',
                        'Sec-Fetch-Dest': 'empty',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'same-site',
                        'Cookie': cookie
                    }
                }, (apiRes) => {
                    let data = '';
                    apiRes.on('data', c => data += c);
                    apiRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            console.log(`[Staff] Fear API status=${apiRes.statusCode}, count=${Array.isArray(parsed) ? parsed.length : 'N/A'}, sample=`, Array.isArray(parsed) && parsed.length > 0 ? parsed[0].name || parsed[0].nickname || parsed[0].steamId : parsed);
                            resolve(Array.isArray(parsed) ? parsed : []);
                        } catch (e) {
                            console.log(`[Staff] Fear API status=${apiRes.statusCode}, parse error: ${e?.message}, data=${data.slice(0, 200)}`);
                            resolve([]);
                        }
                    });
                });
                req.on('error', (err) => { console.log('[Staff] Fear API request error:', err?.message); resolve([]); });
                req.on('timeout', () => { console.log('[Staff] Fear API timeout'); try { req.destroy(); } catch {} resolve([]); });
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

    if (bddStaffPg.isConfigured() && staffList.length > 0) {
        try {
            const discordMap = await bddStaffPg.getDiscordBySteamIds(staffList.map(s => s.steamid));
            staffList = staffList.map(s => {
                const d = discordMap[s.steamid] || {};
                return {
                    ...s,
                    discord_id: d.discord_id || s.discord_id || '',
                    discord_nickname: d.discord_nickname || s.discord_nickname || ''
                };
            });
        } catch (e) {
            console.warn('[Staff] Discord merge error:', e.message);
        }
    }

    // Подтягиваем Discord-аватарки для стаффа
    try {
        const discordIds = staffList.map(s => s.discord_id).filter(Boolean);
        const avatarMap = await fetchDiscordAvatars(discordIds);
        staffList = staffList.map(s => ({
            ...s,
            discord_avatar: avatarMap[s.discord_id] || ''
        }));
    } catch (e) {
        console.warn('[Staff] Discord avatar fetch error:', e.message);
    }

    staffPunishmentsCache.staffList = staffList;
    staffPunishmentsCache.staffListLastUpdated = Date.now();
    staffPunishmentsCache.staffListLoading = false;
    // Перезаписываем staff.json с Discord-аватарками для offline-работы фронтенда.
    if (staffList.length > 0) {
        try {
            fs.writeFileSync(STAFF_JSON_PATH, JSON.stringify(staffList, null, 2), 'utf8');
        } catch (_) {}
    }
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
                    punishments.setPunishmentsToCache(sid, 'admin', normalizedList);
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

