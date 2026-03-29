'use strict';

const https = require('https');

function kdRatio(kills, deaths) {
    const k = Number(kills) || 0;
    const d = Number(deaths) || 0;
    const r = d > 0 ? k / d : k;
    return Math.round(r * 100) / 100;
}

function accountIsoFromUnix(ts) {
    if (!ts || Number(ts) <= 0) return null;
    try {
        return new Date(Number(ts) * 1000).toISOString();
    } catch (_) {
        return null;
    }
}

/**
 * Загрузка сырых репортов Fear (как /api/fear-reports).
 */
function fetchFearRecentReportsArray(fearAccessToken) {
    return new Promise((resolve) => {
        if (!fearAccessToken) {
            resolve([]);
            return;
        }
        const apiUrl = 'https://api.fearproject.ru/reports/recent';
        https.get(apiUrl, {
            headers: {
                Accept: '*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                Origin: 'https://fearproject.ru',
                Referer: 'https://fearproject.ru/',
                Cookie: `__ddg1_=g7Ui979pOEjDNf5BOT9p; access_token=${fearAccessToken}`
            }
        }, (apiRes) => {
            let data = '';
            apiRes.on('data', (c) => { data += c; });
            apiRes.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    resolve(Array.isArray(j) ? j : []);
                } catch (_) {
                    resolve([]);
                }
            });
        }).on('error', () => resolve([]));
    });
}

function cheatPatternsMatch(reason) {
    return /чит|cheat|haron anti-cheat|использование читов/i.test(String(reason || ''));
}

function collectFlagsForPlayer(steamId, banCaches, userLevelForYooma, USER_LEVEL_WHITELIST) {
    const flags = [];
    const sid = String(steamId);

    const sus = banCaches.suspiciousBans && banCaches.suspiciousBans.allBans;
    if (sus) {
        const row = sus.find((b) => String(b.steamId) === sid);
        if (row) {
            flags.push({
                id: 'dxdcs',
                label: 'Подозрительный список',
                source: 'suspicious',
                reason: row.reason || null
            });
        }
    }

    const vac = banCaches.vacBans && banCaches.vacBans.allBans;
    if (vac) {
        const row = vac.find((b) => String(b.SteamId) === sid);
        if (row) {
            flags.push({
                id: 'vac',
                label: 'VAC / Game ban',
                source: 'steam',
                numberOfGameBans: row.NumberOfGameBans,
                daysSinceLastBan: row.DaysSinceLastBan
            });
        }
    }

    const yooma = banCaches.yoomaBans && banCaches.yoomaBans.allBans;
    if (yooma) {
        const row = yooma.find((b) => String(b.steamId) === sid);
        if (row) {
            if (userLevelForYooma >= USER_LEVEL_WHITELIST || !cheatPatternsMatch(row.reason)) {
                flags.push({
                    id: 'yooma',
                    label: 'Yooma',
                    source: 'yooma',
                    reason: row.reason || null,
                    created: row.created || null
                });
            }
        }
    }

    const cs2r = banCaches.cs2redBans && banCaches.cs2redBans.allBans;
    if (cs2r) {
        const row = cs2r.find((b) => String(b.steamId) === sid);
        if (row) {
            flags.push({ id: 'cs2red', label: 'CS2Red', source: 'cs2red', reason: row.reason || null });
        }
    }

    const d00 = banCaches.deti00Bans && banCaches.deti00Bans.allBans;
    if (d00) {
        const row = d00.find((b) => String(b.steamId) === sid);
        if (row) {
            flags.push({ id: 'deti00', label: 'Deti00', source: 'deti00', reason: row.reason || null });
        }
    }

    if (banCaches.pridecs2Bans && banCaches.pridecs2Bans.allBans) {
        const row = banCaches.pridecs2Bans.allBans.find((b) => String(b.steamId) === sid);
        if (row) {
            flags.push({ id: 'pridecs2', label: 'PrideCS2', source: 'pridecs2', reason: row.reason || null });
        }
    }

    const top2 = banCaches.top2Bans && banCaches.top2Bans.allBans;
    if (top2) {
        const row = top2.find((b) => String(b.steamId) === sid);
        if (row) {
            flags.push({ id: 'top2', label: 'Top2', source: 'top2', reason: row.reason || null });
        }
    }

    return flags;
}

function displayFromBanCaches(sid, banCaches) {
    const buckets = [
        banCaches.vacBans && banCaches.vacBans.allBans,
        banCaches.yoomaBans && banCaches.yoomaBans.allBans,
        banCaches.suspiciousBans && banCaches.suspiciousBans.allBans,
        banCaches.cs2redBans && banCaches.cs2redBans.allBans,
        banCaches.deti00Bans && banCaches.deti00Bans.allBans,
        banCaches.pridecs2Bans && banCaches.pridecs2Bans.allBans,
        banCaches.top2Bans && banCaches.top2Bans.allBans
    ].filter(Boolean);
    const found = buckets.flat().find((p) => String(p.SteamId || p.steamId) === sid);
    if (!found) return { nickname: 'Unknown', avatar: null };
    return {
        nickname: found.nickname || found.name || 'Unknown',
        avatar: found.avatar || null
    };
}

/**
 * Единый снимок всех игроков на серверах Fear (для модераторской панели и внешних клиентов).
 * snapshotOpts: для лаунчера — includeOfflineReportSuspects, embedActiveReports, endpoint, schemaVersion.
 */
function buildModeratorPlayersSnapshot({
    cachedServers,
    buildOnlinePlayersContext,
    db,
    cache,
    reportsPayload,
    banCaches,
    userLevelForYooma,
    USER_LEVEL_WHITELIST
}, snapshotOpts = {}) {
    const {
        includeOfflineReportSuspects = false,
        embedActiveReports = false,
        endpoint: endpointOpt = null,
        schemaVersion: schemaVersionOpt = null
    } = snapshotOpts;
    const endpoint = endpointOpt || '/api/moderator/players';
    const schemaVersion = schemaVersionOpt != null ? schemaVersionOpt : 1;
    const markOnline = schemaVersion >= 2;
    const emptySummary = {
        totalPlayersOnline: 0,
        totalAdminsOnline: 0,
        playersInResponse: 0,
        activeReportsUnique: 0,
        cachesReady: false
    };

    if (!cachedServers || !Array.isArray(cachedServers)) {
        const loadingPayload = {
            schemaVersion,
            endpoint,
            generatedAt: new Date().toISOString(),
            loading: true,
            summary: { ...emptySummary, note: 'Кэш серверов ещё не загружен' },
            players: []
        };
        if (embedActiveReports && reportsPayload) loadingPayload.activeReports = reportsPayload;
        return loadingPayload;
    }

    const { steamIds, playerDataMap, totalPlayers, totalAdmins } = buildOnlinePlayersContext(cachedServers);
    const bySteam = reportsPayload && reportsPayload.bySteamId ? reportsPayload.bySteamId : Object.create(null);

    const players = [];
    for (const steamId of steamIds) {
        if (db.isWhitelisted(steamId)) continue;

        const d = playerDataMap.get(steamId);
        const kills = d ? d.kills : 0;
        const deaths = d ? d.deaths : 0;
        const rep = bySteam[steamId];

        const flags = collectFlagsForPlayer(steamId, banCaches, userLevelForYooma, USER_LEVEL_WHITELIST);

        const faceit = cache.faceitLevels.get(steamId);
        const acc = cache.accountAge.get(steamId);

        const row = {
            steamId,
            nickname: d ? d.nickname : 'Unknown',
            avatar: d ? d.avatar : null,
            kills,
            deaths,
            kdRatio: kdRatio(kills, deaths),
            serverName: d ? d.serverName : null,
            serverTag: d ? d.serverName : null,
            serverIp: d ? d.serverIp : null,
            serverPort: d ? d.serverPort : null,
            isAdmin: d ? Boolean(d.isAdmin) : false,
            ping: d && d.ping != null ? d.ping : null,
            flags,
            reportCount: rep ? rep.activeReportCount : 0,
            reportFlagBits: rep ? rep.flagBits : 0,
            reportLabels: rep && rep.labels ? rep.labels : [],
            reportTypeIds: rep && rep.typeIds ? rep.typeIds : [],
            faceit: faceit
                ? { level: faceit.level, elo: faceit.elo, url: faceit.url || null }
                : null,
            accountCreatedAt: accountIsoFromUnix(acc && acc.created),
            whitelisted: false
        };
        if (markOnline) row.online = true;
        players.push(row);
    }

    let offlineReportSuspects = 0;
    if (includeOfflineReportSuspects && bySteam) {
        const onlineSet = new Set(steamIds);
        for (const sid of Object.keys(bySteam)) {
            if (onlineSet.has(sid) || db.isWhitelisted(sid)) continue;
            offlineReportSuspects += 1;
            const rep = bySteam[sid];
            const flags = collectFlagsForPlayer(sid, banCaches, userLevelForYooma, USER_LEVEL_WHITELIST);
            const { nickname, avatar } = displayFromBanCaches(sid, banCaches);
            const faceitOff = cache.faceitLevels.get(sid);
            const accOff = cache.accountAge.get(sid);
            const offRow = {
                steamId: sid,
                nickname,
                avatar,
                kills: 0,
                deaths: 0,
                kdRatio: 0,
                serverName: null,
                serverTag: null,
                serverIp: null,
                serverPort: null,
                isAdmin: false,
                ping: null,
                flags,
                reportCount: rep ? rep.activeReportCount : 0,
                reportFlagBits: rep ? rep.flagBits : 0,
                reportLabels: rep && rep.labels ? rep.labels : [],
                reportTypeIds: rep && rep.typeIds ? rep.typeIds : [],
                faceit: faceitOff
                    ? { level: faceitOff.level, elo: faceitOff.elo, url: faceitOff.url || null }
                    : null,
                accountCreatedAt: accountIsoFromUnix(accOff && accOff.created),
                whitelisted: false
            };
            if (markOnline) offRow.online = false;
            players.push(offRow);
        }
    }

    players.sort((a, b) => {
        if (markOnline && a.online !== b.online) return a.online ? -1 : 1;
        if (b.reportCount !== a.reportCount) return b.reportCount - a.reportCount;
        if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length;
        return b.kills - a.kills;
    });

    const out = {
        schemaVersion,
        endpoint,
        generatedAt: new Date().toISOString(),
        loading: false,
        summary: {
            totalPlayersOnline: totalPlayers,
            totalAdminsOnline: totalAdmins,
            playersInResponse: players.length,
            activeReportsUnique: reportsPayload && reportsPayload.summary
                ? reportsPayload.summary.uniqueSuspects || 0
                : 0,
            cachesReady: true,
            ...(offlineReportSuspects ? { offlineReportSuspects } : {})
        },
        players
    };
    if (embedActiveReports && reportsPayload) out.activeReports = reportsPayload;
    return out;
}

/** Снимок для лаунчера: онлайн + подозреваемые по активным репортам вне серверов + тот же контракт репортов, что /api/active-reports */
function buildLauncherPlayersSnapshot(args) {
    return buildModeratorPlayersSnapshot(args, {
        includeOfflineReportSuspects: true,
        embedActiveReports: true,
        endpoint: '/api/launcher/players',
        schemaVersion: 2
    });
}

module.exports = {
    buildModeratorPlayersSnapshot,
    buildLauncherPlayersSnapshot,
    fetchFearRecentReportsArray,
    kdRatio
};
