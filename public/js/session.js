function escapeHtml(s) {
    const x = String(s ?? '');
    return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Экранирование для передачи в onclick="addToWhitelist('...', '...')"
function escapeForOnclick(s) {
    if (s == null || s === '') return '';
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' ').slice(0, 64);
}

function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (_) { return {}; }
}

function setCurrentUserPatch(patch) {
    try {
        const cur = getCurrentUser();
        localStorage.setItem('user', JSON.stringify({ ...cur, ...patch }));
    } catch (_) {}
}

function getUserLevel() {
    return getCurrentUser().level || 0;
}

function clearAuthAndRedirectToAuth() {
    try { localStorage.removeItem('user'); } catch (_) {}
    const next = (location && (location.pathname + location.search + location.hash)) || '/';
    window.location.href = '/auth?next=' + encodeURIComponent(next);
}

let __csrfToken = '';
async function ensureCsrfToken() {
    if (__csrfToken) return __csrfToken;
    const r = await fetch('/api/csrf', { method: 'GET', credentials: 'same-origin' });
    if (r.status === 401) {
        clearAuthAndRedirectToAuth();
        throw new Error('Unauthorized');
    }
    if (!r.ok) throw new Error('Failed to get CSRF token');
    const data = await r.json().catch(() => ({}));
    __csrfToken = String(data.csrfToken || '').trim();
    if (!__csrfToken) throw new Error('Invalid CSRF token');
    return __csrfToken;
}

async function appApiFetch(input, init) {
    const opts = init ? { ...init } : {};
    const method = String((opts.method || 'GET')).toUpperCase();
    opts.credentials = 'same-origin';
    opts.headers = { ...(opts.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD') {
        const csrf = await ensureCsrfToken();
        opts.headers['X-CSRF-Token'] = csrf;
    }
    const r = await fetch(input, opts);
    if (r.status === 401) {
        clearAuthAndRedirectToAuth();
    }
    return r;
}

window.App = window.App || {};
window.App.session = {
    escapeHtml,
    escapeForOnclick,
    getCurrentUser,
    setCurrentUserPatch,
    getUserLevel,
    apiFetch: appApiFetch,
    ensureCsrfToken,
    clearAuthAndRedirectToAuth
};

