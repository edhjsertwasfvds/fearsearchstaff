'use strict';

/** Кэш whitelist в памяти: синхронные проверки в WS и горячих путях без await. */
let bySteamId = new Map();

async function refresh(db) {
    const rows = await db.getWhitelist();
    const m = new Map();
    for (const r of rows || []) {
        m.set(String(r.steam_id), r);
    }
    bySteamId = m;
}

function has(steamId) {
    return bySteamId.has(String(steamId));
}

function entry(steamId) {
    return bySteamId.get(String(steamId)) || null;
}

module.exports = { refresh, has, entry };
