'use strict';

/**
 * Checker backend: VDF parsing + Steam/Fear/Yooma checks.
 * Mirrors the Python FastAPI backend from fearcheker.vercel.app
 * so the frontend at /checker works without the external Vercel API.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const url = require('url');
const querystring = require('querystring');

const db = require('./database');

const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const FEAR_API_BASE = process.env.FEAR_API_BASE || 'https://api.fearproject.ru';
const YOOMA_API = 'https://yooma.su/api/public/read/punishments';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const _fearCache = new Map(); // steamid -> { data, ts }
const _yoomaCache = new Map(); // steamid -> { data, ts }

const FEAR_SEM = { limit: 80, running: 0, queue: [] };
const YOOMA_SEM = { limit: 80, running: 0, queue: [] };

function getJson(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = url.parse(urlStr);
        const client = parsed.protocol === 'https:' ? https : http;
        const qs = options.search || '';
        const req = client.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + (parsed.search || '') + qs,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = body ? JSON.parse(body) : null;
                    resolve({ status: res.statusCode, data, body });
                } catch (e) {
                    resolve({ status: res.statusCode, data: null, body });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (options.body) req.write(options.body);
        req.end();
    });
}

function parseVdfSteamids(text) {
    if (!text) return [];
    let found = [];
    const m1 = text.match(/"SteamID"\s+"(7656\d{13})"/g);
    if (m1) found = m1.map(s => s.match(/"(7656\d{13})"/)[1]);
    if (found.length === 0) {
        const m2 = text.match(/"(7656119\d{10})"/g);
        if (m2) found = m2.map(s => s.replace(/"/g, ''));
    }
    if (found.length === 0) {
        const m3 = text.match(/(7656119\d{10})/g);
        if (m3) found = m3;
    }
    return Array.from(new Set(found));
}

function parseMultipart(body, contentType) {
    const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
    if (!boundaryMatch) return [];
    const boundaryStr = '--' + boundaryMatch[1].replace(/^"|"$/g, '');
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'binary');
    const boundary = Buffer.from(boundaryStr, 'ascii');
    const files = [];
    let start = 0;
    while (true) {
        const idx = buf.indexOf(boundary, start);
        if (idx === -1) break;
        const nextStart = idx + boundary.length;
        if (start > 0) {
            // content between previous boundary and current boundary
            let part = buf.slice(start, idx);
            // strip leading CRLF and trailing CRLF/--
            if (part.length >= 2 && part.slice(0, 2).toString('hex') === '0d0a') part = part.slice(2);
            if (part.length >= 2 && part.slice(part.length - 2).toString('hex') === '0d0a') part = part.slice(0, part.length - 2);
            else if (part.length >= 2 && part.slice(part.length - 2).toString('hex') === '2d2d') part = part.slice(0, part.length - 2);
            const headerEnd = part.indexOf('\r\n\r\n');
            const headerEndAlt = part.indexOf('\n\n');
            const splitAt = headerEnd !== -1 ? headerEnd + 4 : (headerEndAlt !== -1 ? headerEndAlt + 2 : -1);
            if (splitAt > 0) {
                const headers = part.slice(0, splitAt).toString('utf8');
                const content = part.slice(splitAt);
                const cdMatch = headers.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
                if (cdMatch) {
                    files.push({ name: cdMatch[1], filename: cdMatch[2] || '', content });
                }
            }
        }
        if (nextStart >= buf.length) break;
        // check if end of multipart
        const tail = buf.slice(nextStart, Math.min(nextStart + 4, buf.length));
        if (tail.toString('ascii') === '--\r\n' || tail.toString('ascii') === '--') break;
        start = nextStart;
    }
    return files;
}

function parseVdfFilesFromRequest(req, body) {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return { ids: [], vdfText: '', filename: '' };
    const files = parseMultipart(body, contentType);
    let allIds = [];
    let vdfText = '';
    let filename = '';
    for (const file of files) {
        if (!file.filename || !file.filename.toLowerCase().endsWith('.vdf')) continue;
        if (!filename) filename = file.filename;
        const text = file.content.toString('utf8') || file.content.toString('latin1');
        vdfText += '\n' + text;
        const ids = parseVdfSteamids(text);
        allIds.push(...ids);
    }
    return { ids: Array.from(new Set(allIds)), vdfText, filename };
}

async function checkSteamBatch(steamids) {
    const idsStr = steamids.slice(0, 100).join(',');
    const params = { key: STEAM_API_KEY, steamids: idsStr };
    const qs = '?' + querystring.stringify(params);
    const bansUrl = 'https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/' + qs;
    const summaryUrl = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/' + qs;

    let bansRes, summaryRes;
    try {
        [bansRes, summaryRes] = await Promise.all([
            getJson(bansUrl, { timeout: 8000 }),
            getJson(summaryUrl, { timeout: 8000 })
        ]);
    } catch (e) {
        console.error('[Checker Steam] batch error:', e.message);
        return { bans: {}, summaries: {} };
    }

    const bansMap = {};
    if (bansRes.status === 200 && bansRes.data && bansRes.data.players) {
        for (const p of bansRes.data.players) {
            const sid = p.SteamId || p.SteamID || p.steamid || p.steamID;
            if (sid) bansMap[String(sid)] = p;
        }
    }
    const summariesMap = {};
    if (summaryRes.status === 200 && summaryRes.data && summaryRes.data.response && summaryRes.data.response.players) {
        for (const p of summaryRes.data.response.players) {
            summariesMap[p.steamid] = p;
        }
    }
    return { bans: bansMap, summaries: summariesMap };
}

async function acquire(sem, fn) {
    if (sem.running < sem.limit) {
        sem.running++;
        try {
            return await fn();
        } finally {
            sem.running--;
            if (sem.queue.length > 0) {
                const next = sem.queue.shift();
                next();
            }
        }
    }
    return new Promise((resolve) => {
        sem.queue.push(() => {
            acquire(sem, fn).then(resolve);
        });
    });
}

async function checkFear(steamid) {
    const now = Date.now();
    const cached = _fearCache.get(steamid);
    if (cached && now - cached.ts < CACHE_TTL) return cached.data;

    const profileUrl = `${FEAR_API_BASE}/profile/${steamid}`;
    try {
        const res = await getJson(profileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 5000
        });
        console.log(`[Checker] Fear ${steamid}: status=${res.status}, hasData=${Boolean(res.data)}, url=${profileUrl}`);
        if (res.status === 200 && res.data) {
            _fearCache.set(steamid, { data: res.data, ts: now });
            return res.data;
        }
    } catch (e) {
        console.log(`[Checker] Fear ${steamid}: error ${e.message}, url=${profileUrl}`);
    }
    return null;
}

function mskFromTimestamp(ts) {
    if (!ts) return '—';
    try {
        const d = new Date(ts * 1000);
        return d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    } catch (e) {
        return '—';
    }
}

async function checkYooma(steamid) {
    const now = Date.now();
    const cached = _yoomaCache.get(steamid);
    if (cached && now - cached.ts < CACHE_TTL) return cached.data;

    const params = {
        punish_type: 0,
        search: steamid,
        page: 1,
        mobile: 1
    };
    const qs = '?' + querystring.stringify(params);
    try {
        const res = await getJson(YOOMA_API + qs, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://yooma.su/ru/punishments',
                'Origin': 'https://yooma.su'
            },
            timeout: 5000
        });
        console.log(`[Checker] Yooma ${steamid}: status=${res.status}, ok=${res.data && res.data.ok}, punishments=${Array.isArray(res.data && res.data.punishments) ? res.data.punishments.length : 0}`);
        if (res.status !== 200 || !res.data || !res.data.ok) {
            const result = { found: false, punishments: [] };
            _yoomaCache.set(steamid, { data: result, ts: now });
            return result;
        }
        const punishments = res.data.punishments || [];
        const nowTs = Math.floor(Date.now() / 1000);
        const processed = [];
        for (const p of punishments) {
            if (String(p.steamid || '').trim() !== String(steamid)) continue;
            const createdTs = p.created || 0;
            const expiresTs = p.expires || 0;
            const unpunishId = p.unpunish_admin_id;
            let status;
            if (unpunishId !== null && unpunishId !== 0 && unpunishId !== undefined) {
                status = 'unbanned';
            } else if (expiresTs > 0 && expiresTs < nowTs) {
                status = 'expired';
            } else {
                status = 'active';
            }
            const createdStr = mskFromTimestamp(createdTs);
            const expiresStr = expiresTs > 0 ? mskFromTimestamp(expiresTs) : 'Навсегда';
            let durStr;
            if (expiresTs <= 0) {
                durStr = 'Навсегда';
            } else {
                const diff = expiresTs - createdTs;
                const days = Math.floor(diff / 86400);
                durStr = days >= 1 ? `${days} дн.` : `${Math.floor(diff / 3600)} ч.`;
            }
            processed.push({
                id: p.id,
                name: p.name || '—',
                steamid,
                reason: p.reason || '—',
                admin_name: p.admin_name || '—',
                created: createdStr,
                expires: expiresStr,
                duration: durStr,
                status,
                created_ts: createdTs,
                expires_ts: expiresTs,
                profile_url: `https://yooma.su/ru/profile/${steamid}`
            });
        }
        const result = { found: processed.length > 0, punishments: processed };
        _yoomaCache.set(steamid, { data: result, ts: now });
        return result;
    } catch (e) {
        console.error('[Checker Yooma] error for', steamid, e.message);
        const result = { found: false, punishments: [] };
        _yoomaCache.set(steamid, { data: result, ts: now });
        return result;
    }
}

async function checkAccounts(steamids) {
    const uniqueIds = Array.from(new Set(steamids));
    const bansMap = {};
    const summariesMap = {};
    for (let i = 0; i < uniqueIds.length; i += 100) {
        const batch = uniqueIds.slice(i, i + 100);
        const res = await checkSteamBatch(batch);
        Object.assign(bansMap, res.bans);
        Object.assign(summariesMap, res.summaries);
    }

    const checkOne = async (sid) => {
        const [fear, yooma] = await Promise.all([
            acquire(FEAR_SEM, () => checkFear(sid)),
            acquire(YOOMA_SEM, () => checkYooma(sid))
        ]);
        const steamBan = bansMap[sid] || {};
        const summary = summariesMap[sid] || {};

        const vacBanned = steamBan.VACBanned || false;
        const vacDays = steamBan.DaysSinceLastBan || 0;
        const gameBans = steamBan.NumberOfGameBans || 0;
        const communityBan = steamBan.CommunityBanned || false;
        const nickname = summary.personaname || sid;
        const avatar = summary.avatarfull || summary.avatar || '';

        const onFear = fear !== null;
        const banInfo = fear ? (fear.banInfo || {}) : {};
        const fearBanned = banInfo.isBanned || false;
        const fearReason = fearBanned ? (banInfo.reason || '') : '';
        const fearUnbanTs = fearBanned ? (banInfo.unbanTimestamp || null) : null;
        let fearUnban = '';
        if (fearUnbanTs) {
            try {
                fearUnban = new Date(fearUnbanTs * 1000).toLocaleString('ru-RU');
            } catch (e) { /* ignore */ }
        }

        let adminGroup = '';
        if (fear) {
            if (typeof fear.adminGroup === 'object' && fear.adminGroup && fear.adminGroup.group_name) {
                adminGroup = fear.adminGroup.group_name;
            } else if (fear.rank_name) {
                adminGroup = fear.rank_name;
            } else if (fear.rank) {
                adminGroup = String(fear.rank);
            }
            if (!adminGroup || /^\d+$/.test(adminGroup)) adminGroup = '';
        }

        return {
            steamid: sid,
            nickname: (fear && fear.name) || nickname || sid,
            avatar,
            on_fear: onFear,
            fear_banned: fearBanned,
            fear_reason: fearReason,
            fear_unban: fearUnban,
            fear_unban_ts: fearUnbanTs,
            vac_banned: vacBanned,
            vac_days: vacDays,
            game_bans: gameBans,
            community_ban: communityBan,
            yooma_data: yooma,
            admin_group: adminGroup
        };
    };

    return await Promise.all(uniqueIds.map(checkOne));
}

function toFrontend(r) {
    const yoomaData = r.yooma_data || {};
    const active = (yoomaData.punishments || []).filter(p => p.status === 'active');
    return {
        steamid: r.steamid || '',
        nickname: r.nickname || '',
        avatar: r.avatar || '',
        onFear: r.on_fear || false,
        fearBanned: r.fear_banned || false,
        fearReason: r.fear_reason || '',
        fearUnban: r.fear_unban_ts || null,
        vacBanned: r.vac_banned || false,
        vacDays: r.vac_days || 0,
        gameBans: r.game_bans || 0,
        communityBan: r.community_ban || false,
        yoomaFound: yoomaData.found || false,
        yoomaBans: active.map(p => ({
            id: p.id,
            reason: p.reason || '—',
            admin: p.admin_name || '—',
            created: p.created_ts,
            expires: p.expires_ts
        }))
    };
}

async function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function handleParseVdf(req, res) {
    const body = await readRequestBody(req);
    const { ids, vdfText, filename } = parseVdfFilesFromRequest(req, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        total_found: ids.length,
        unique_ids: ids.length,
        steamids: ids,
        vdf_text: vdfText
    }));
}

async function handleCheckVdf(req, res) {
    const body = await readRequestBody(req);
    const { ids, vdfText, filename } = parseVdfFilesFromRequest(req, body);
    if (ids.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'SteamID не найдены в файле' }));
        return;
    }
    const results = await checkAccounts(ids);
    const checkId = await db.saveVdfHistory(results, filename || '', vdfText || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        results: results.map(toFrontend),
        total: results.length,
        check_id: checkId,
        saved: Boolean(checkId)
    }));
}

async function handleCheckAll(req, res) {
    const body = await readRequestBody(req);
    let payload;
    try {
        payload = JSON.parse(body.toString('utf8'));
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Invalid JSON' }));
        return;
    }
    const steamids = payload.steamids || [];
    if (!Array.isArray(steamids) || steamids.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'No steamids provided' }));
        return;
    }
    const results = await checkAccounts(steamids);
    const checkId = await db.saveVdfHistory(results, '', '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        results: results.map(toFrontend),
        total: results.length,
        check_id: checkId,
        saved: Boolean(checkId)
    }));
}

async function handleDownloadVdf(checkId, res) {
    const row = await db.getVdfContentByCheckId(Number(checkId));
    if (!row || !row.content) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'VDF-файл не найден' }));
        return;
    }
    let filename = row.filename || `check_${checkId}.vdf`;
    if (!filename.toLowerCase().endsWith('.vdf')) filename += '.vdf';
    res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`
    });
    res.end(row.content);
}

async function handleDebug(req, res, rawUrlPath) {
    if (rawUrlPath === '/checker/api/debug/parse-vdf' && req.method === 'POST') {
        const body = await readRequestBody(req);
        const { ids, vdfText, filename } = parseVdfFilesFromRequest(req, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            total_found: ids.length,
            unique_ids: ids.length,
            filename: filename || '',
            steamids: ids,
            vdf_text_preview: String(vdfText || '').slice(0, 500)
        }));
        return;
    }

    const fearMatch = rawUrlPath.match(/^\/checker\/api\/debug\/fear\/(.+)$/);
    if (fearMatch && req.method === 'GET') {
        const steamid = decodeURIComponent(fearMatch[1]);
        const data = await checkFear(steamid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            steamid,
            fear_api_base: FEAR_API_BASE,
            found: Boolean(data),
            profile: data,
            banInfo: data ? (data.banInfo || null) : null
        }));
        return;
    }

    const yoomaMatch = rawUrlPath.match(/^\/checker\/api\/debug\/yooma\/(.+)$/);
    if (yoomaMatch && req.method === 'GET') {
        const steamid = decodeURIComponent(yoomaMatch[1]);
        const data = await checkYooma(steamid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            steamid,
            found: data && data.found,
            active: (data && data.punishments || []).filter(p => p.status === 'active').length,
            data
        }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
}

async function handleCheckerApi(req, res, rawUrlPath) {
    if (rawUrlPath === '/checker/api/parse-vdf' && req.method === 'POST') {
        await handleParseVdf(req, res);
        return;
    }
    if (rawUrlPath === '/checker/api/check-vdf' && req.method === 'POST') {
        await handleCheckVdf(req, res);
        return;
    }
    if (rawUrlPath === '/checker/api/check-all' && req.method === 'POST') {
        await handleCheckAll(req, res);
        return;
    }
    if (rawUrlPath.startsWith('/checker/api/download-vdf/') && req.method === 'GET') {
        const checkId = rawUrlPath.replace('/checker/api/download-vdf/', '');
        await handleDownloadVdf(checkId, res);
        return;
    }
    if (rawUrlPath.startsWith('/checker/api/debug/')) {
        await handleDebug(req, res, rawUrlPath);
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
}

module.exports = {
    handleCheckerApi,
    parseVdfSteamids,
    checkAccounts,
    toFrontend
};
