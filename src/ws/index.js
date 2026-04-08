const WebSocket = require('ws');
const https = require('https');

function attachWss({
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
}) {
    const wss = new WebSocket.Server({ server });

    console.log('WebSocket сервер запущен');

    wss.on('connection', (ws, req) => {
        const wsIp = getClientIp(req || { headers: {}, socket: {} });
        const wsUa = truncateForLog(req?.headers?.['user-agent'] || '-', 220);
        const wsOrigin = truncateForLog(req?.headers?.origin || '-', 140);
        ws._clientMeta = { ip: wsIp, ua: wsUa, origin: wsOrigin };
        console.log(`[WS] connected ip=${wsIp} origin=${wsOrigin} ua="${wsUa}"`);

        // Отправляем текущие данные сразу при подключении
        sendCurrentData(ws);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                const sid = data && data.sessionToken ? auth.getSession(String(data.sessionToken)) : null;
                const type = data && data.type ? String(data.type) : 'unknown';
                const steamId = data && data.steamId != null ? String(data.steamId) : '-';
                console.log(
                    `[WS] message type=${truncateForLog(type, 64)} ip=${truncateForLog(ws?._clientMeta?.ip || '-', 80)} steamId=${truncateForLog(steamId, 32)} ${sessionLogChunk(sid)}`
                );
                if (data.type !== 'get_account_age_batch') {
                    console.log('Получено сообщение от клиента:', data);
                }

                // Обработка запросов от клиента
                if (data.type === 'get_stats') {
                    sendStats(ws);
                } else if (data.type === 'get_vac_bans') {
                    sendVACBans(ws);
                } else if (data.type === 'get_yooma_bans') {
                    // Никогда не доверяем userLevel от клиента — берём из серверной сессии.
                    const level = sid && Number.isFinite(Number(sid.level)) ? Number(sid.level) : 0;
                    sendYoomaBans(ws, level);
                } else if (data.type === 'get_suspicious_bans') {
                    const level = sid && Number.isFinite(Number(sid.level)) ? Number(sid.level) : 0;
                    sendSuspiciousBans(ws, level);
                } else if (data.type === 'get_all_players') {
                    sendAllPlayers(ws);
                } else if (data.type === 'get_faceit_levels') {
                    sendFaceitLevels(ws);
                } else if (data.type === 'get_player_games') {
                    sendPlayerGames(ws, data.steamId);
                } else if (data.type === 'get_account_age_batch') {
                    const steamIds = Array.isArray(data.steamIds) ? data.steamIds.map(id => String(id)).filter(Boolean) : [];
                    if (steamIds.length === 0) return;

                    const results = [];
                    const toFetch = [];

                    for (const sid2 of steamIds) {
                        const cached = cache.accountAge.get(sid2);
                        if (cached) {
                            results.push({ steamId: sid2, created: cached.created });
                        } else {
                            toFetch.push(sid2);
                        }
                    }

                    if (results.length > 0 && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'account_age_batch', results }));
                    }

                    if (!STEAM_API_KEY || toFetch.length === 0) return;

                    const BATCH_SIZE = 100;
                    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
                        const batch = toFetch.slice(i, i + BATCH_SIZE);
                        const ids = batch.join(',');
                        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${ids}`;
                        https.get(url, (res) => {
                            let apiData = '';
                            res.on('data', chunk => apiData += chunk);
                            res.on('end', () => {
                                const fetched = [];
                                try {
                                    const result = JSON.parse(apiData || '{}');
                                    const players = result.response?.players || [];
                                    const playerMap = new Map(players.map(p => [p.steamid, p.timecreated || 0]));
                                    for (const sid3 of batch) {
                                        const created = playerMap.get(sid3) || 0;
                                        cache.accountAge.set(sid3, { created, lastCheck: Date.now() });
                                        fetched.push({ steamId: sid3, created });
                                    }
                                } catch (_) {
                                    for (const sid3 of batch) {
                                        fetched.push({ steamId: sid3, created: 0 });
                                    }
                                }
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ type: 'account_age_batch', results: fetched }));
                                }
                            });
                        }).on('error', () => {
                            const fetched = batch.map(sid3 => ({ steamId: sid3, created: 0 }));
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: 'account_age_batch', results: fetched }));
                            }
                        });
                    }
                } else if (data.type === 'add_to_whitelist') {
                    const session = data.sessionToken ? auth.getSession(data.sessionToken) : null;
                    if (!session || session.level < 1) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Войдите для добавления в чистые' }));
                        }
                        return;
                    }
                    const steamId2 = data.steamId != null ? String(data.steamId).trim() : '';
                    const nickname = (data.nickname != null ? String(data.nickname).trim() : 'Unknown').slice(0, 128);
                    if (!steamId2 || !/^\d{17}$/.test(steamId2)) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Некорректный SteamID' }));
                        }
                        return;
                    }
                    try {
                        db.addToWhitelist(steamId2, nickname, String(session.userId), session.username, 'Отмечен как чистый');
                        db.logAction(String(session.userId), session.username, 'add_to_whitelist', steamId2, nickname, 'Добавлен в whitelist', null);
                        broadcastUpdate('vac_bans_update', {});
                        broadcastUpdate('yooma_bans_update', {});
                        broadcastUpdate('suspicious_bans_update', {});
                        broadcastUpdate('all_players_update', {});
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'whitelist_added', steamId: steamId2, success: true }));
                        }
                    } catch (err) {
                        console.error('[Whitelist] Ошибка добавления:', err);
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка при добавлении в whitelist' }));
                        }
                    }
                } else if (data.type === 'remove_from_whitelist') {
                    const session = data.sessionToken ? auth.getSession(data.sessionToken) : null;
                    if (!session || session.level < 1) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Войдите для удаления из чистых' }));
                        }
                        return;
                    }
                    const { steamId: steamId3, nickname } = data;
                    const entry = db.getWhitelistEntry(steamId3);
                    const isOwn = entry && String(entry.added_by_discord_id) === String(session.userId);
                    const canRemove = session.level >= USER_LEVEL_WHITELIST || isOwn;
                    if (!entry || !canRemove) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: isOwn ? 'Игрок не в whitelist' : 'Можно удалять только своих или нужен уровень 3+' }));
                        }
                        return;
                    }
                    db.removeFromWhitelist(steamId3);
                    db.logAction(String(session.userId), session.username, 'remove_from_whitelist', steamId3, nickname, 'Удален из whitelist', null);

                    broadcastUpdate('vac_bans_update', {});
                    broadcastUpdate('yooma_bans_update', {});
                    broadcastUpdate('suspicious_bans_update', {});
                    broadcastUpdate('all_players_update', {});
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'whitelist_removed', steamId: steamId3, success: true }));
                    }
                }
            } catch (err) {
                console.error('Ошибка обработки сообщения:', err);
            }
        });

        ws.on('close', () => {
            console.log('WebSocket подключение закрыто');
        });

        ws.on('error', (err) => {
            console.error('WebSocket ошибка:', err);
        });
    });

    return wss;
}

module.exports = { attachWss };

