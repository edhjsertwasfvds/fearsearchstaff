const auth = require('../auth');

function getSessionFromReq(req) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token ? auth.getSession(token) : null;
}

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function sendError(res, status, code, error) {
    sendJson(res, status, { code, error });
}

function requireSession(req, res, minLevel = 0) {
    const session = getSessionFromReq(req);
    if (!session) {
        sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
        return null;
    }
    if (session.level < minLevel) {
        sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав');
        return null;
    }
    return session;
}

function getAllowedMethodsForApiPath(pathname) {
    if (pathname === '/api/auth/login') return 'POST, OPTIONS';
    if (pathname === '/api/auth/logout') return 'POST, OPTIONS';
    if (pathname === '/api/auth/session') return 'POST, OPTIONS';
    if (pathname === '/api/auth/register-by-invite') return 'POST, OPTIONS';
    if (pathname === '/api/auth/validate-invite') return 'GET, OPTIONS';

    if (pathname === '/api/users') return 'GET, POST, OPTIONS';
    if (/^\/api\/users\/\d+$/.test(pathname)) return 'PUT, DELETE, OPTIONS';
    if (pathname === '/api/users/reset') return 'DELETE, OPTIONS';
    if (pathname === '/api/users/restore-env') return 'POST, OPTIONS';

    if (pathname === '/api/invites') return 'GET, OPTIONS';
    if (pathname === '/api/invites/generate') return 'POST, OPTIONS';
    if (/^\/api\/invites\/[^/]+$/.test(pathname)) return 'DELETE, OPTIONS';

    if (pathname === '/api/logs') return 'GET, OPTIONS';
    if (pathname === '/api/whitelist') return 'GET, OPTIONS';
    if (pathname === '/api/activity') return 'GET, OPTIONS';
    if (pathname === '/api/staff') return 'GET, OPTIONS';
    if (pathname === '/api/maintenance') return 'GET, POST, OPTIONS';
    if (pathname === '/api/update-notice') return 'GET, POST, OPTIONS';
    if (pathname === '/api/settings') return 'GET, POST, OPTIONS';
    if (pathname === '/api/me') return 'GET, OPTIONS';
    if (pathname === '/api/runtime-metrics') return 'GET, OPTIONS';
    if (pathname === '/api/clear-cache') return 'POST, OPTIONS';
    if (pathname === '/api/comments') return 'POST, OPTIONS';
    if (pathname === '/api/punishments') return 'GET, OPTIONS';
    if (pathname === '/api/punishments/staff-stats') return 'GET, OPTIONS';
    if (pathname === '/api/fear-reports') return 'GET, OPTIONS';
    if (pathname === '/api/active-reports') return 'GET, OPTIONS';
    if (pathname === '/api/moderator/players') return 'GET, OPTIONS';
    if (pathname === '/api/launcher/players') return 'GET, OPTIONS';
    if (pathname === '/api/fear/admins/find') return 'POST, OPTIONS';
    if (pathname === '/api/fear/admins/edit') return 'POST, OPTIONS';

    if (pathname.startsWith('/api/check/')) return 'GET, OPTIONS';
    if (pathname.startsWith('/api/steam-friends/')) return 'GET, OPTIONS';
    if (pathname.startsWith('/api/steam-avatar/')) return 'GET, OPTIONS';
    return 'GET, OPTIONS';
}

function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
        return xff.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
}

module.exports = {
    getSessionFromReq,
    sendJson,
    sendError,
    requireSession,
    getAllowedMethodsForApiPath,
    getClientIp
};

