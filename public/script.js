/**
 * Единое состояние приложения. Все данные с сервера и UI — только здесь.
 * Обновляется только из обработчика WebSocket → рендер читает state и обновляет DOM.
 */
const state = {
    stats: null,
    vac:   { loading: false, players: [] },
    yooma: { loading: false, players: [] },
    suspicious: { loading: false, players: [] },
    allPlayers: { loading: false, players: [] },
    faceitLevels: {},
    openCategory: null,
    userLevel: 0,
    userId: null,
    userSteamId: '',
    launcherApiKey: '',
    customFiltersOpen: false,
    filtersMenuOpen: false,
    columnsMenuOpen: false,
    punishments: { count: 0, list: [], loading: false, lastSteamId: '', selectedMonth: null, view: 'list', staffList: null, staffStatsRows: null, staffStatsLoading: false, staffStatsData: {}, staffStatsProgress: null, staffTicketsYm: null, staffTicketsBySid: {}, staffTicketsLoading: false, staffRolesBySid: {}, staffRolesLoading: false, staffPayConfig: {}, secureLoaded: false, staffTableMode: 'new', statsPeriodMode: 'month', selectedWeekStart: null, lastLoadedAt: 0, lastSource: '' },
    changesTab: 'roles',
    rolesEditor: { authMode: 'cookie', accessToken: '', steamid: '', name: '', adminId: '', roleName: 'Модератор', log: [] }
};
const ROLES_EDITOR_ACCESS_TOKEN_KEY = 'rolesEditorAccessToken';

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let playersPanelRefreshQueued = false;
let playersPanelRefreshTimer = null;
let uiOpenSelectMenu = null;
let rolesAutoResolveTimer = null;

const DEFAULT_AVATAR = 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg';

const apiFetch = (window.App && window.App.session && window.App.session.apiFetch) ? window.App.session.apiFetch : fetch;

let __toastWrap = null;
function showToast(message, variant = 'info') {
    const msg = String(message || '').trim();
    if (!msg) return;
    if (!__toastWrap) {
        __toastWrap = document.createElement('div');
        __toastWrap.id = 'appToasts';
        __toastWrap.className = 'fixed top-4 right-4 z-[400] flex flex-col gap-2';
        document.body.appendChild(__toastWrap);
    }
    const toast = document.createElement('div');
    const base = 'px-4 py-3 rounded-xl border shadow-xl text-sm font-semibold max-w-[360px]';
    const styles = variant === 'error'
        ? 'bg-rose-500/15 border-rose-500/30 text-rose-200'
        : (variant === 'success'
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
            : 'bg-white/10 border-white/15 text-gray-200');
    toast.className = `${base} ${styles}`;
    toast.textContent = msg;
    __toastWrap.appendChild(toast);
    setTimeout(() => { try { toast.remove(); } catch (_) {} }, 3200);
}

function closeUiSelectMenu() {
    if (!uiOpenSelectMenu) return;
    uiOpenSelectMenu.classList.add('hidden');
    const trigger = uiOpenSelectMenu.parentElement?.querySelector('.ui-select-trigger');
    if (trigger) trigger.classList.remove('open');
    uiOpenSelectMenu = null;
}

function initUiSelects(root = document) {
    const selects = Array.from(root.querySelectorAll('select[data-ui-select="1"]:not([data-ui-select-init="1"])'));
    selects.forEach((select) => {
        const parent = select.parentElement;
        if (!parent) return;

        let wrap = parent;
        if (!parent.classList.contains('ui-select-wrap')) {
            wrap = document.createElement('div');
            wrap.className = 'ui-select-wrap';
            parent.insertBefore(wrap, select);
            wrap.appendChild(select);
        }

        select.dataset.uiSelectInit = '1';
        select.classList.add('hidden');

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ui-select-trigger';

        const label = document.createElement('span');
        label.className = 'truncate';
        const updateLabel = () => {
            const selected = select.options[select.selectedIndex];
            label.textContent = selected ? selected.textContent : '';
        };
        updateLabel();

        const caret = document.createElement('i');
        caret.className = 'ph ph-caret-down text-gray-500 text-xs';
        trigger.append(label, caret);

        const menu = document.createElement('div');
        menu.className = 'ui-select-menu hidden';

        const syncActive = () => {
            Array.from(menu.querySelectorAll('.ui-select-item')).forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.value === select.value);
            });
        };

        Array.from(select.options).forEach((opt) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'ui-select-item';
            item.textContent = opt.textContent || '';
            item.dataset.value = opt.value;
            item.addEventListener('click', () => {
                if (select.value !== opt.value) {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                updateLabel();
                syncActive();
                closeUiSelectMenu();
            });
            menu.appendChild(item);
        });
        syncActive();

        trigger.addEventListener('click', () => {
            const opening = menu.classList.contains('hidden');
            closeUiSelectMenu();
            if (!opening) return;
            menu.classList.remove('hidden');
            trigger.classList.add('open');
            uiOpenSelectMenu = menu;
        });

        select.addEventListener('change', () => {
            updateLabel();
            syncActive();
        });

        wrap.append(trigger, menu);
    });
}

async function loadBoundSteamAvatar(steamId) {
    const avatarEl = document.getElementById('userAvatar');
    if (!avatarEl) return;
    const sid = String(steamId || '').trim();
    const cachedAvatar = String(getCurrentUser().avatar || '').trim();
    if (!/^\d{5,}$/.test(sid)) {
        avatarEl.style.display = 'none';
        avatarEl.innerHTML = '';
        return;
    }
    if (cachedAvatar) {
        avatarEl.style.display = '';
        avatarEl.className = 'mb-3';
        avatarEl.innerHTML = `<img src="${cachedAvatar.replace(/^http:\/\//i, 'https://')}" class="w-16 h-16 rounded-full border border-white/10 object-cover" alt="avatar">`;
        return;
    }
    try {
        const res = await apiFetch('/api/steam-avatar/' + encodeURIComponent(sid));
        const data = await res.json().catch(() => ({}));
        const avatar = String(data?.avatar || '').trim();
        if (!avatar) {
            avatarEl.style.display = 'none';
            avatarEl.innerHTML = '';
            return;
        }
        avatarEl.style.display = '';
        avatarEl.className = 'mb-3';
        avatarEl.innerHTML = `<img src="${avatar.replace(/^http:\/\//i, 'https://')}" class="w-16 h-16 rounded-full border border-white/10 object-cover" alt="avatar">`;
        setCurrentUserPatch({ avatar });
    } catch (_) {
        avatarEl.style.display = 'none';
        avatarEl.innerHTML = '';
    }
}

const LOCAL_SETTINGS_KEY = 'localUiSettings';
const PLAYERS_COLUMNS_KEY = 'playersTableColumns';
const PLAYERS_EXCLUSIONS_KEY = 'playersTableExclusions';

const PLAYERS_COLUMNS_DEF = [
    { id: 'num', label: '№', default: true },
    { id: 'player', label: 'Игрок', default: true },
    { id: 'flags', label: 'Флаги', default: true },
    { id: 'kd', label: 'K/D', default: true },
    { id: 'accDate', label: 'Дата акка', default: true },
    { id: 'actions', label: 'Действия', default: true }
];

function getPlayersTableColumns() {
    try {
        const raw = localStorage.getItem(PLAYERS_COLUMNS_KEY);
        if (!raw) return PLAYERS_COLUMNS_DEF.reduce((acc, c) => ({ ...acc, [c.id]: c.default }), {});
        const parsed = JSON.parse(raw);
        return PLAYERS_COLUMNS_DEF.reduce((acc, c) => ({ ...acc, [c.id]: parsed[c.id] !== false }), {});
    } catch (_) {
        return PLAYERS_COLUMNS_DEF.reduce((acc, c) => ({ ...acc, [c.id]: c.default }), {});
    }
}

function setPlayersTableColumns(cols) {
    localStorage.setItem(PLAYERS_COLUMNS_KEY, JSON.stringify(cols));
}

function togglePlayersColumn(colId) {
    const cols = getPlayersTableColumns();
    cols[colId] = !cols[colId];
    setPlayersTableColumns(cols);
    scheduleRenderPanel();
}

function getPlayersExclusions() {
    try {
        const raw = localStorage.getItem(PLAYERS_EXCLUSIONS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                excludeCsgoServers: Boolean(parsed.excludeCsgoServers)
            };
        }
    } catch (_) {}
    return { excludeCsgoServers: false };
}

function setPlayersExclusions(obj) {
    const prev = getPlayersExclusions();
    localStorage.setItem(PLAYERS_EXCLUSIONS_KEY, JSON.stringify({ ...prev, ...obj }));
}

function togglePlayersExclusion(key) {
    const ex = getPlayersExclusions();
    ex[key] = !ex[key];
    setPlayersExclusions(ex);
    schedulePlayersPanelRefresh(false, 0);
    scheduleRenderPanel();
}

function applyPlayersExclusions(players) {
    const ex = getPlayersExclusions();
    if (!ex.excludeCsgoServers) return players;
    return (Array.isArray(players) ? players : []).filter(p => {
        const g = String(p?.serverGame || '').trim().toUpperCase();
        return !(g.includes('CSGO') || g.includes('CS:GO'));
    });
}

function getLocalSettings() {
    const defaults = {
        theme: 'dark',
        animationMode: 'full',
        smoothScrollMode: 'balanced'
    };
    try {
        const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        const animationMode = parsed.animationMode
            || (parsed.animations === false ? 'off' : 'full');
        const smoothScrollMode = parsed.smoothScrollMode
            || (parsed.smoothScroll === false ? 'off' : 'balanced');
        return {
            theme: ['dark', 'midnight', 'indigo', 'emerald', 'crimson', 'graphite'].includes(parsed.theme) ? parsed.theme : 'dark',
            animationMode: ['off', 'soft', 'full'].includes(animationMode) ? animationMode : 'full',
            smoothScrollMode: ['off', 'balanced', 'glide'].includes(smoothScrollMode) ? smoothScrollMode : 'balanced'
        };
    } catch (_) {
        return defaults;
    }
}

function applyLocalSettings(settings = getLocalSettings()) {
    const body = document.body;
    if (!body) return;
    body.classList.remove('theme-midnight', 'theme-indigo', 'theme-emerald', 'theme-crimson', 'theme-graphite');
    if (settings.theme === 'midnight') body.classList.add('theme-midnight');
    if (settings.theme === 'indigo') body.classList.add('theme-indigo');
    if (settings.theme === 'emerald') body.classList.add('theme-emerald');
    if (settings.theme === 'crimson') body.classList.add('theme-crimson');
    if (settings.theme === 'graphite') body.classList.add('theme-graphite');
    body.classList.toggle('local-no-anim', settings.animationMode === 'off');
    body.classList.toggle('local-soft-anim', settings.animationMode === 'soft');

    const scrollMode = (settings.smoothScrollMode === 'off' && settings.animationMode === 'off')
        ? 'balanced'
        : settings.smoothScrollMode;

    window.__smoothWheelMode = scrollMode;
    window.__smoothWheelEnabled = scrollMode === 'glide';
    const behavior = scrollMode === 'off' ? 'auto' : 'smooth';
    document.documentElement.style.scrollBehavior = behavior;
    body.style.scrollBehavior = behavior;
    const panel = document.getElementById('panelContent');
    if (panel) panel.style.scrollBehavior = behavior;
}

function setLocalGroupSelection(selector, attrName, value) {
    document.querySelectorAll(selector).forEach(btn => {
        const current = btn.getAttribute(attrName);
        btn.classList.toggle('active', current === value);
    });
}

function openLocalSettingsModal() {
    const modal = document.getElementById('localSettingsModal');
    if (!modal) return;
    const s = getLocalSettings();
    modal.dataset.theme = s.theme;
    modal.dataset.anim = s.animationMode;
    modal.dataset.scroll = s.smoothScrollMode;
    setLocalGroupSelection('[data-local-theme]', 'data-local-theme', s.theme);
    setLocalGroupSelection('[data-local-anim]', 'data-local-anim', s.animationMode);
    setLocalGroupSelection('[data-local-scroll]', 'data-local-scroll', s.smoothScrollMode);
    modal.classList.remove('hidden');
}

function closeLocalSettingsModal() {
    const modal = document.getElementById('localSettingsModal');
    if (modal) modal.classList.add('hidden');
}

function saveLocalSettings() {
    const modal = document.getElementById('localSettingsModal');
    const next = {
        theme: modal?.dataset.theme || 'dark',
        animationMode: modal?.dataset.anim || 'full',
        smoothScrollMode: modal?.dataset.scroll || 'balanced'
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    applyLocalSettings(next);
    closeLocalSettingsModal();
}

function resetLocalSettings() {
    localStorage.removeItem(LOCAL_SETTINGS_KEY);
    const defaults = getLocalSettings();
    applyLocalSettings(defaults);
    const modal = document.getElementById('localSettingsModal');
    if (modal) {
        modal.dataset.theme = defaults.theme;
        modal.dataset.anim = defaults.animationMode;
        modal.dataset.scroll = defaults.smoothScrollMode;
    }
    setLocalGroupSelection('[data-local-theme]', 'data-local-theme', defaults.theme);
    setLocalGroupSelection('[data-local-anim]', 'data-local-anim', defaults.animationMode);
    setLocalGroupSelection('[data-local-scroll]', 'data-local-scroll', defaults.smoothScrollMode);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getPunishmentCreatedTs(p) {
    const raw = p && (p.created ?? p.created_at ?? p.date ?? p.timestamp ?? p.time ?? p.punish_time ?? p.ban_time ?? p.issue_time ?? p.start_time);
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return raw > 1e12 ? Math.floor(raw / 1000) : raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        const asNum = parseInt(trimmed, 10);
        if (Number.isFinite(asNum)) return asNum > 1e12 ? Math.floor(asNum / 1000) : asNum;
        const ms = Date.parse(trimmed.replace(' ', 'T'));
        if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
    }
    return null;
}

function punishmentInSelectedPeriod(p, selectedPeriod) {
    const sel = String(selectedPeriod || '').trim();
    if (!sel) return true;
    const ts = getPunishmentCreatedTs(p);
    if (ts == null) return false;
    const d = new Date(ts * 1000);
    if (sel.startsWith('week:')) {
        const startStr = sel.slice(5).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return false;
        const [yy, mm, dd] = startStr.split('-').map(n => parseInt(n, 10));
        const start = new Date(yy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0);
        if (Number.isNaN(start.getTime())) return false;
        // Week is Wednesday -> Wednesday (7 days).
        const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
        return d >= start && d < end;
    }
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return ym === sel;
}

/** Должно совпадать с логикой в staff-stats-secure.js (новая таблица). */
function isStaffStatsExcludedReason(reason) {
    const r = String(reason || '').trim().toLowerCase();
    if (!r) return false;
    const compact = r.replace(/\s+/g, ' ').trim();
    const noSpace = compact.replace(/\s/g, '');
    if (compact.includes('напиши тикет в дс')) return true;
    if (noSpace.includes('напишитикетвдс')) return true;
    const hasTicket = r.includes('тикет') || r.includes('ticket');
    const hasDs = r.includes('дс') || r.includes('ds') || r.includes('discord') || r.includes('дискорд');
    const hasWrite = r.includes('напиши') || r.includes('пиши') || r.includes('напишите');
    if (hasTicket && hasDs) return true;
    if (hasWrite && hasDs) return true;
    if (/напиши.*(тикет|ticket).*(дс|ds|discord|дискорд)/i.test(r)) return true;
    if (/(тикет|ticket).*(дс|ds|discord|дискорд)/i.test(r)) return true;
    return false;
}

function staffStatsPunishmentReason(p) {
    if (!p || typeof p !== 'object') return '';
    const raw = p.reason ?? p.ban_reason ?? p.message ?? p.comment ?? p.desc ?? p.punish_reason ?? p.text ?? '';
    return String(raw || '').trim();
}

function staffStatsPunishmentStatus(p) {
    if (!p || typeof p !== 'object') return -1;
    const keys = ['status', 'ban_status', 'state', 'punishment_status'];
    for (let i = 0; i < keys.length; i++) {
        const c = p[keys[i]];
        if (c == null || c === '') continue;
        const n = parseInt(c, 10);
        if (Number.isFinite(n)) return n;
    }
    return -1;
}

// ——— WebSocket ———

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempts = 0;
        requestAll();
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            applyMessage(data);
        } catch (err) {
            console.error('Ошибка парсинга сообщения:', err);
        }
    };
    
    ws.onerror = () => {};
    ws.onclose = () => {
        if (reconnectTimer) return;
        const baseDelay = 1000;
        const maxDelay = 30000;
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, reconnectAttempts || 0));
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectWebSocket();
        }, delay);
    };
}

function requestAll() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const level = getUserLevel();
    ws.send(JSON.stringify({ type: 'get_stats' }));
    ws.send(JSON.stringify({ type: 'get_vac_bans' }));
    ws.send(JSON.stringify({ type: 'get_yooma_bans', userLevel: level }));
    ws.send(JSON.stringify({ type: 'get_suspicious_bans', userLevel: level }));
    ws.send(JSON.stringify({ type: 'get_all_players' }));
    ws.send(JSON.stringify({ type: 'get_faceit_levels' }));
}

let _punishmentsPrefetchStarted = false;
function prefetchPunishmentsSummary() {
    if (_punishmentsPrefetchStarted) return;
    _punishmentsPrefetchStarted = true;
    state.punishments.loading = true;
    apiFetch('/api/punishments')
        .then(r => r.json())
        .catch(() => ({ count: 0, punishments: [] }))
        .then(d => {
            state.punishments = {
                ...state.punishments,
                count: d.count || 0,
                list: Array.isArray(d.punishments) ? d.punishments : [],
                loading: false
            };
            renderCounts();
            if (state.openCategory === 'Наказания') scheduleRenderPanel();
        })
        .catch(() => {
            state.punishments.loading = false;
            renderCounts();
        });
}

function isPlayersCategoryOpen() {
    return state.openCategory === 'Игроки' || state.openCategory === 'Опасные';
}

function isCreatedSortActive() {
    return (localStorage.getItem('suspiciousSortMethod') || 'kills') === 'created';
}

function isFaceitHideActive() {
    const hf = getHideFilters();
    return Boolean(hf.enabled && (hf.minFaceit > 0 || hf.maxFaceit > 0));
}

function schedulePlayersPanelRefresh(withAnimation = false, delay = 80) {
    if (!isPlayersCategoryOpen()) return;
    if (playersPanelRefreshTimer) {
        clearTimeout(playersPanelRefreshTimer);
        playersPanelRefreshTimer = null;
    }
    if (playersPanelRefreshQueued) return;
    playersPanelRefreshQueued = true;
    playersPanelRefreshTimer = setTimeout(() => {
        playersPanelRefreshQueued = false;
        playersPanelRefreshTimer = null;
        refreshAllPlayersPanel(withAnimation);
    }, delay);
}

/** Единственная точка обновления состояния из сообщений сервера */
function applyMessage(data) {
    switch (data.type) {
        case 'stats':
            state.stats = data;
            renderCounts();
            break;
        case 'vac_bans':
            if (!data.loading) {
                state.vac = { loading: false, players: Array.isArray(data.players) ? data.players : [] };
            } else {
                state.vac.loading = true;
            }
            renderCounts();
            scheduleRenderPanel();
            break;
        case 'yooma_bans':
            if (!data.loading) {
                state.yooma = { loading: false, players: Array.isArray(data.players) ? data.players : [] };
            } else {
                state.yooma.loading = true;
            }
            renderCounts();
            scheduleRenderPanel();
            break;
        case 'suspicious_bans':
            if (!data.loading) {
                state.suspicious = { loading: false, players: Array.isArray(data.players) ? data.players : [] };
            } else {
                state.suspicious.loading = true;
            }
            renderCounts();
            if (isPlayersCategoryOpen()) schedulePlayersPanelRefresh(false);
            break;
        case 'all_players':
            if (!data.loading) {
                state.allPlayers = { loading: false, players: Array.isArray(data.players) ? data.players : [] };
            } else {
                state.allPlayers.loading = true;
            }
            if (isPlayersCategoryOpen()) schedulePlayersPanelRefresh(false);
            break;
        case 'stats_update':
            ws.send(JSON.stringify({ type: 'get_stats' }));
            break;
        case 'vac_bans_update':
            ws.send(JSON.stringify({ type: 'get_vac_bans' }));
            break;
        case 'yooma_bans_update':
            ws.send(JSON.stringify({ type: 'get_yooma_bans', userLevel: getUserLevel() }));
            break;
        case 'suspicious_bans_update':
            ws.send(JSON.stringify({ type: 'get_suspicious_bans', userLevel: getUserLevel() }));
            break;
        case 'all_players_update':
            ws.send(JSON.stringify({ type: 'get_all_players' }));
            break;
        case 'faceit_levels':
            if (data.levels) {
                state.faceitLevels = data.levels;
                applyFaceitLevels();
                if (isPlayersCategoryOpen() && isFaceitHideActive()) schedulePlayersPanelRefresh(false, 120);
            }
            break;
        case 'faceit_levels_update':
            ws.send(JSON.stringify({ type: 'get_faceit_levels' }));
            break;
        case 'account_age':
            applyAccountAge(data, { scheduleRefresh: isCreatedSortActive() });
            break;
        case 'account_age_batch':
            if (Array.isArray(data.results)) {
                data.results.forEach(r => applyAccountAge(r, { scheduleRefresh: false }));
                if (isPlayersCategoryOpen() && isCreatedSortActive()) {
                    schedulePlayersPanelRefresh(false, 120);
                }
            }
            break;
        case 'player_games':
            applyPlayerGames(data);
            break;
        default:
            break;
    }
}

// ——— Рендер: только чтение state и обновление DOM ———

function renderCounts() {
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        const newVal = Math.max(0, value);
        if (el.textContent !== String(newVal)) {
            el.textContent = newVal;
            const badge = el.closest('[class*="rounded-full"]');
            if (badge) {
                badge.classList.remove('badge-bump');
                void badge.offsetWidth;
                badge.classList.add('badge-bump');
            }
        }
    };
    if (state.stats) {
        set('adminCount', state.stats.totalAdmins ?? 0);
        set('playerCount', state.stats.totalPlayers ?? 0);
    }
    const fromStats = state.stats?.categories;
    set('vacCount', state.vac.players.length || (fromStats?.vac ?? 0));
    let yoomaPlayers = state.yooma.players;
    if (state.userLevel >= 1 && state.userLevel <= 2 && yoomaPlayers.length > 0) {
        const allowedReasons = /обход|отказ|haron anti-cheat|anti-cheat|^AC$/i;
        yoomaPlayers = yoomaPlayers.filter(p => allowedReasons.test((p.reason || '').trim()));
    }
    set('yoomaCount', yoomaPlayers.length || (fromStats?.yooma ?? 0));
    set('suspiciousCount', state.suspicious.players.length || (fromStats?.suspicious ?? 0));
    set('nicknamesCount', fromStats?.nicknames ?? 0);
}

const FEAR_ROLE_BY_GROUP_ID = {
    1: 'Модератор',
    2: 'Admin1Day',
    3: 'STAFF',
    4: 'Админ',
    5: 'STMODER',
    6: 'MLMODER',
    7: 'STADMIN',
    8: 'GLADMIN',
    9: 'ADMIN+',
    10: 'MEDIA'
};
const FEAR_GROUP_ID_BY_ROLE = Object.fromEntries(Object.entries(FEAR_ROLE_BY_GROUP_ID).map(([k, v]) => [v, Number(k)]));

function buildChangesLayout(activeTab, mainHtml) {
    const rolesActive = activeTab === 'roles';
    return `
        <div class="flex gap-4">
            <div class="w-[180px] shrink-0">
                <div class="rounded-xl border border-white/10 bg-white/[0.03] p-2 space-y-1">
                    <button type="button" onclick="setChangesTab('roles')" class="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${rolesActive ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/20' : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent'}">Роли</button>
                </div>
                <div class="mt-2 text-[11px] text-gray-500 px-1">Доступ: с 3 уровня</div>
            </div>
            <div class="min-w-0 flex-1">${mainHtml}</div>
        </div>
    `;
}

function setChangesTab(tab) {
    state.changesTab = tab === 'punishments' ? 'punishments' : 'roles';
    if (state.openCategory === 'Изменения' && state.changesTab === 'punishments') {
        loadPunishmentsStaffList();
        prefetchPunishmentsSummary();
    }
    scheduleRenderPanel();
}

function appendRolesLog(line) {
    const s = `[${new Date().toLocaleTimeString('ru')}] ${line}`;
    state.rolesEditor.log.push(s);
    if (state.rolesEditor.log.length > 120) state.rolesEditor.log = state.rolesEditor.log.slice(-120);
}

function matchFearAdminScore(admin, key) {
    const q = String(key || '').trim();
    if (!q) return -1;
    const sid = String(admin?.steamid || '').trim();
    const name = String(admin?.name || '').trim();
    const ql = q.toLowerCase();
    const nl = name.toLowerCase();
    if (sid === q) return 1000;
    if (name === q) return 900;
    if (nl === ql) return 800;
    if (/^\d{8,}$/.test(q) && sid.includes(q)) return 700;
    if (ql && nl.includes(ql)) return 600 + Math.min(100, ql.length);
    return -1;
}

function syncRolesEditorFromInputs() {
    const get = (id) => document.getElementById(id);
    state.rolesEditor.accessToken = extractAccessToken(String(get('fearAccessToken')?.value || '').trim());
    state.rolesEditor.authMode = 'cookie';
    state.rolesEditor.steamid = String(get('fearSteamid')?.value || '').trim();
    state.rolesEditor.roleName = String(get('fearRoleName')?.value || 'Модератор').trim();
}

function loadRolesEditorAccessToken() {
    try {
        const saved = String(localStorage.getItem(ROLES_EDITOR_ACCESS_TOKEN_KEY) || '').trim();
        if (saved) state.rolesEditor.accessToken = extractAccessToken(saved);
    } catch (_) {}
}

function saveRolesEditorAccessToken() {
    try {
        const token = extractAccessToken(state.rolesEditor.accessToken || '');
        if (!token) localStorage.removeItem(ROLES_EDITOR_ACCESS_TOKEN_KEY);
        else localStorage.setItem(ROLES_EDITOR_ACCESS_TOKEN_KEY, token);
    } catch (_) {}
}

function onRolesEditorAccessTokenInput() {
    syncRolesEditorFromInputs();
    saveRolesEditorAccessToken();
}

function onRolesEditorSteamidInput() {
    syncRolesEditorFromInputs();
    if (rolesAutoResolveTimer) clearTimeout(rolesAutoResolveTimer);
    rolesAutoResolveTimer = setTimeout(() => {
        fearFindAdminId({ silent: true });
    }, 350);
}

function extractAccessToken(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (s.includes('access_token=')) {
        const start = s.indexOf('access_token=') + 'access_token='.length;
        const rest = s.slice(start);
        const end = rest.indexOf(';');
        return (end >= 0 ? rest.slice(0, end) : rest).trim();
    }
    return s;
}

async function fearFindAdminId(options = {}) {
    const silent = Boolean(options && options.silent);
    syncRolesEditorFromInputs();
    const token = state.rolesEditor.accessToken;
    const key = state.rolesEditor.steamid;
    if (!token) { if (!silent) showToast('Вставь access token', 'error'); return false; }
    if (!key) { if (!silent) showToast('Заполни steamid', 'error'); return false; }
    if (!silent) appendRolesLog('Запрос списка админов...');
    scheduleRenderPanel();
    try {
        const res = await apiFetch('/api/fear/admins/find', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, authMode: 'cookie', key })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            if (!silent) appendRolesLog('Ошибка: ' + (data.error || res.status));
            scheduleRenderPanel();
            return false;
        }
        const payload = data.payload;
        const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.admins) ? payload.admins : (Array.isArray(payload?.data) ? payload.data : []));
        const scored = list
            .filter(a => a && typeof a === 'object')
            .map(a => ({ s: matchFearAdminScore(a, key), a }))
            .filter(x => x.s >= 0)
            .sort((x, y) => y.s - x.s);
        if (!scored.length) {
            state.rolesEditor.adminId = '';
            state.rolesEditor.name = '';
            if (!silent) appendRolesLog('Совпадений не найдено');
            scheduleRenderPanel();
            return false;
        }
        const top = scored[0].a;
        const adminId = top.admin_id ?? top.id ?? '';
        state.rolesEditor.adminId = String(adminId || '');
        state.rolesEditor.steamid = String(top.steamid || state.rolesEditor.steamid || '');
        state.rolesEditor.name = String(top.name || state.rolesEditor.name || '');
        const gid = Number(top.group_id ?? top.groupId ?? 0);
        if (FEAR_ROLE_BY_GROUP_ID[gid]) state.rolesEditor.roleName = FEAR_ROLE_BY_GROUP_ID[gid];
        if (!silent) appendRolesLog(`Найден: id=${state.rolesEditor.adminId} | ${state.rolesEditor.name} | ${state.rolesEditor.steamid}`);
        scheduleRenderPanel();
        return true;
    } catch (e) {
        if (!silent) appendRolesLog('Ошибка: ' + String(e?.message || e));
        scheduleRenderPanel();
        return false;
    }
}

async function fearApplyRoleEdit() {
    syncRolesEditorFromInputs();
    const token = state.rolesEditor.accessToken;
    const groupId = FEAR_GROUP_ID_BY_ROLE[state.rolesEditor.roleName];
    if (!token) { showToast('Вставь access token', 'error'); return; }
    if (!groupId) { showToast('Выбери роль', 'error'); return; }
    if (!state.rolesEditor.steamid) { showToast('Заполни steamid', 'error'); return; }
    if (!state.rolesEditor.adminId) {
        appendRolesLog('Поиск admin_id по steamid...');
        const resolved = await fearFindAdminId({ silent: true });
        if (!resolved || !state.rolesEditor.adminId) {
            appendRolesLog('Не удалось определить admin_id автоматически');
            scheduleRenderPanel();
            showToast('Не удалось определить admin_id по steamid', 'error');
            return;
        }
    }
    const adminId = parseInt(state.rolesEditor.adminId, 10);
    if (!Number.isFinite(adminId)) { showToast('Нужен корректный admin_id', 'error'); return; }
    const resolvedName = String(state.rolesEditor.name || state.rolesEditor.steamid || '').trim();
    const payloadSnake = { admin_id: adminId, group_id: groupId, steamid: state.rolesEditor.steamid, name: resolvedName };
    const payloadCamel = { id: adminId, groupId: groupId, steamid: state.rolesEditor.steamid, name: resolvedName };
    appendRolesLog('Отправка /admins/edit (try #1 camelCase)...');
    scheduleRenderPanel();
    try {
        const res1 = await apiFetch('/api/fear/admins/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, authMode: 'cookie', payload: payloadCamel })
        });
        const data1 = await res1.json().catch(() => ({}));
        appendRolesLog(`Статус #1: ${res1.status}`);
        appendRolesLog(JSON.stringify(data1));
        if (res1.ok) {
            scheduleRenderPanel();
            return;
        }
        appendRolesLog('Отправка /admins/edit (try #2 snake_case)...');
        const res2 = await apiFetch('/api/fear/admins/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, authMode: 'cookie', payload: payloadSnake })
        });
        const data2 = await res2.json().catch(() => ({}));
        appendRolesLog(`Статус #2: ${res2.status}`);
        appendRolesLog(JSON.stringify(data2));
    } catch (e) {
        appendRolesLog('Ошибка: ' + String(e?.message || e));
    }
    scheduleRenderPanel();
}

function renderPanel() {
    const content = document.getElementById('panelContent');
    const title = document.getElementById('panelTitle');
    if (!content || !title) return;

    const cat = state.openCategory;
    if (!cat) return;

    if (cat === 'Проверка' && document.getElementById('checkInput')) return;

    title.textContent = cat;

    if (cat === 'VAC') {
        const { loading, players } = state.vac;
        if (loading && players.length === 0) {
        content.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">Загрузка данных VAC...</p>';
        } else if (players.length > 0) {
            content.innerHTML = buildVacTable(players);
            requestAccountAgeFor(players, 'SteamId');
        } else {
            content.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">Нет игроков с Game банами</p>';
        }
        staggerRows(content);
        return;
    }
    
    if (cat === 'Yooma') {
        const { loading, players } = state.yooma;
        let filtered = players;
        if (state.userLevel >= 1 && state.userLevel <= 2) {
            const allowedReasons = /обход|отказ|haron anti-cheat|anti-cheat|^AC$/i;
            filtered = players.filter(p => {
                const r = (p.reason || '').trim();
                return allowedReasons.test(r);
            });
        }
        if (loading && players.length === 0) {
            content.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">Загрузка данных Yooma...</p>';
        } else if (filtered.length > 0) {
            content.innerHTML = buildYoomaTable(filtered);
            requestAccountAgeFor(filtered, 'steamId');
        } else {
            content.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">Нет забаненных игроков на Yooma</p>';
        }
        staggerRows(content);
        return;
    }

    if (cat === 'Игроки' || cat === 'Опасные') {
        const { loading, players } = state.allPlayers;
        if (loading && players.length === 0) {
            content.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">Загрузка игроков...</p>';
        } else {
            const merged = mergeAllPlayersWithBans(players);
            content.innerHTML = buildAllPlayersTable(merged);
            staggerRows(content);
            requestAccountAgeFor(merged, 'steamId');
        }
        return;
    }

    if (cat === 'Изменения' && state.changesTab === 'roles') {
        const roleOptions = Object.values(FEAR_ROLE_BY_GROUP_ID).map(role =>
            `<option value="${escapeHtml(role)}" ${state.rolesEditor.roleName === role ? 'selected' : ''}>${escapeHtml(role)}</option>`
        ).join('');
        const main = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <input id="fearAccessToken" oninput="onRolesEditorAccessTokenInput()" type="text" value="${escapeHtml(state.rolesEditor.accessToken)}" placeholder="access_token" class="md:col-span-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-indigo-500">
                <select id="fearRoleName" data-ui-select="1" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">${roleOptions}</select>
                <input id="fearSteamid" oninput="onRolesEditorSteamidInput()" type="text" value="${escapeHtml(state.rolesEditor.steamid)}" placeholder="steamid" class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-indigo-500">
            </div>
            <div class="flex flex-wrap gap-2 mb-3">
                <button type="button" onclick="fearApplyRoleEdit()" class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg">Применить роль</button>
            </div>
            <div class="rounded-lg border border-white/10 bg-black/20 p-3 h-[320px] overflow-y-auto text-xs font-mono text-gray-300 whitespace-pre-wrap">${escapeHtml((state.rolesEditor.log || []).join('\n') || 'Лог пуст')}</div>
        `;
        title.textContent = 'Изменения';
        content.innerHTML = buildChangesLayout('roles', main);
        initUiSelects(content);
        return;
    }

    if (cat === 'Наказания') {
        const { loading, list, selectedMonth, view } = state.punishments;
        const ownSteamMode = getUserLevel() < 3;
        const ownSteamId = String(state.userSteamId || '');
        const punishmentsError = String(state.punishments.error || '').trim();
        const punishmentsInputHtml = `
            <div class="flex gap-2 mb-4">
                <input type="text" id="punishmentsSteamIdInput" placeholder="${ownSteamMode ? 'Ваш SteamID или SteamID обычного админа' : 'SteamID админа'}" autocomplete="off" class="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono" value="${escapeHtml(state.punishments.lastSteamId || ownSteamId || '')}" onkeydown="if(event.key==='Enter') loadPunishmentsBySteamId()">
                <button type="button" onclick="loadPunishmentsBySteamId()" class="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors">${ownSteamMode ? 'Обновить' : 'Загрузить'}</button>
            </div>`;

        const formatTs = (ts) => {
            if (ts == null || ts === '') return '—';
            const n = parseInt(ts, 10);
            if (!Number.isFinite(n)) return '—';
            return new Date(n * 1000).toLocaleString('ru');
        };
        const formatDuration = (dur) => {
            if (dur == null || dur === '') return '—';
            const n = parseInt(dur, 10);
            if (!Number.isFinite(n) || n <= 0) return 'Навсегда';
            if (n < 3600) return n / 60 + ' мин';
            if (n < 86400) return n / 3600 + ' ч';
            return Math.floor(n / 86400) + ' дн';
        };
        const typeLabel = (t) => (t === 1 ? 'Бан' : t === 2 ? 'Мут' : t);
        const statusLabel = (s) => {
            if (s === 4) return { text: 'Истек срок', class: 'bg-gray-500/20 text-gray-400' };
            if (s === 2) return { text: 'Разбанен', class: 'bg-emerald-500/20 text-emerald-400' };
            if (s === 1) return { text: 'Забанен/мут', class: 'bg-rose-500/20 text-rose-400' };
            return { text: '—', class: 'bg-white/5 text-gray-500' };
        };
        const getCreatedTs = (p) => getPunishmentCreatedTs(p);
        const isVisibleStatus = (p) => {
            const s = Number(p?.status);
            return s === 1 || s === 4;
        };
        const isUnbannedStatus = (p) => Number(p?.status) === 2;
        const normalizeReason = (reason) => {
            const r = String(reason || '').trim();
            return r || 'Без причины';
        };
        const buildReasonStats = (arr) => {
            const map = {};
            (Array.isArray(arr) ? arr : []).forEach(p => {
                const key = normalizeReason(p.reason);
                map[key] = (map[key] || 0) + 1;
            });
            return Object.entries(map).sort((a, b) => b[1] - a[1]);
        };

        const monthOptions = (() => {
            const months = new Set();
            list.forEach(p => {
                const ts = getCreatedTs(p);
                if (ts != null && ts > 0) {
                    const d = new Date(ts * 1000);
                    months.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
                }
            });
            const statsData = state.punishments.staffStatsData || {};
            Object.values(statsData).forEach(arr => {
                if (!Array.isArray(arr)) return;
                arr.forEach(p => {
                    const ts = getCreatedTs(p);
                    if (ts != null && ts > 0) {
                        const d = new Date(ts * 1000);
                        months.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
                    }
                });
            });
            const arr = Array.from(months).sort().reverse();
            const labels = arr.map(ym => {
                const [y, m] = ym.split('-');
                const date = new Date(parseInt(y), parseInt(m) - 1);
                return { value: ym, label: date.toLocaleDateString('ru', { month: 'long', year: 'numeric' }) };
            });
            return { all: { value: '', label: 'Все время' }, months: labels };
        })();

        const weekOptions = (() => {
            const starts = new Set();
            const addTs = (ts) => {
                if (!ts || ts <= 0) return;
                // Use "noon local time" to avoid timezone/DST edge cases shifting the weekday.
                const d = new Date(ts * 1000);
                d.setHours(12, 0, 0, 0);
                // Wednesday-start week (Wed=0..Tue=6)
                const day = (d.getDay() - 3 + 7) % 7;
                const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day, 12, 0, 0, 0);
                const ymd = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
                starts.add(ymd);
            };
            list.forEach(p => addTs(getCreatedTs(p)));
            const statsData = state.punishments.staffStatsData || {};
            Object.values(statsData).forEach(arr => {
                if (!Array.isArray(arr)) return;
                arr.forEach(p => addTs(getCreatedTs(p)));
            });
            const arr = Array.from(starts).sort().reverse().slice(0, 12);
            const labels = arr.map(ymd => {
                const [yy, mm, dd] = String(ymd).split('-').map(n => parseInt(n, 10));
                const start = new Date(yy, (mm || 1) - 1, dd || 1, 12, 0, 0, 0);
                const endInclusive = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
                const label = start.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' }) + ' — ' + endInclusive.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
                return { value: ymd, label };
            });
            return labels;
        })();

        const monthScopedList = selectedMonth
            ? list.filter(p => {
                const ts = getCreatedTs(p);
                if (ts == null) return false;
                const d = new Date(ts * 1000);
                const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                return ym === selectedMonth;
            })
            : list;
        const filteredList = monthScopedList.filter(isVisibleStatus);
        const unbannedList = monthScopedList.filter(isUnbannedStatus);
        /** Список наказаний: активные + истёкшие + разбанен (одна таблица, без отдельного счётчика «снято»). */
        const displayList = monthScopedList.filter((p) => {
            const s = Number(p?.status);
            return s === 1 || s === 2 || s === 4;
        });
        const visibleReasons = buildReasonStats(filteredList);
        const unbannedReasons = buildReasonStats(unbannedList);
        const canViewStaffStats = getUserLevel() >= 3;
        if (view === 'stats' && !canViewStaffStats) {
            state.punishments.view = 'list';
        }
        const effectiveView = (view === 'stats' && !canViewStaffStats) ? 'list' : view;

        const isWeekMode = state.punishments.statsPeriodMode === 'week' && !!state.punishments.selectedWeekStart;
        const currentPeriodLabel = isWeekMode
            ? (weekOptions.find(w => w.value === state.punishments.selectedWeekStart)?.label || state.punishments.selectedWeekStart)
            : (selectedMonth ? (monthOptions.months.find(m => m.value === selectedMonth)?.label || selectedMonth) : monthOptions.all.label);
        const monthDropdownItems = [
            `<button type="button" class="ui-select-item month-select-item ${!selectedMonth ? 'active' : ''}" onclick="setPunishmentsMonth('')">${monthOptions.all.label}</button>`,
            ...monthOptions.months.map(m =>
                `<button type="button" class="ui-select-item month-select-item ${selectedMonth === m.value ? 'active' : ''}" onclick="setPunishmentsMonth('${escapeHtml(m.value)}')">${escapeHtml(m.label)}</button>`
            )
        ].join('');
        const weekDropdownItems = weekOptions.map(w =>
            `<button type="button" class="ui-select-item month-select-item ${(state.punishments.selectedWeekStart === w.value && isWeekMode) ? 'active' : ''}" onclick="setPunishmentsWeekStart('${escapeHtml(w.value)}')">Неделя: ${escapeHtml(w.label)}</button>`
        ).join('');

        const staffTableMode = getUserLevel() === 3 ? 'old' : (state.punishments.staffTableMode === 'old' ? 'old' : 'new');
        const monthSelectHtml = `
            <div class="flex flex-wrap items-center gap-3 mb-4">
                <div class="relative ui-select-wrap month-select-wrap" id="monthDropdownWrap">
                    <button type="button" onclick="toggleMonthDropdown()" class="ui-select-trigger month-select-trigger">
                        <i class="ph ph-calendar-blank text-emerald-400"></i>
                        <span id="monthDropdownLabel">${escapeHtml(currentPeriodLabel)}</span>
                        <i class="ph ph-caret-down text-gray-500 text-xs"></i>
                    </button>
                    <div id="monthDropdownList" class="ui-select-menu month-select-menu hidden w-52">
                        ${monthDropdownItems}
                        ${weekOptions.length ? '<div class="my-1 border-t border-white/10"></div>' : ''}
                        ${weekDropdownItems}
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 ml-auto justify-end">
                    <button type="button" onclick="setPunishmentsView(\'list\')" class="px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${effectiveView === 'list' ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">Список наказаний</button>
                    ${canViewStaffStats
                        ? `<button type="button" onclick="setPunishmentsView('stats')" class="px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${effectiveView === 'stats' ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">Статистика стафа</button>
                           ${effectiveView === 'stats' && getUserLevel() > 3 ? `
                            <button type="button" onclick="setStaffStatsTableMode('old')" class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${staffTableMode === 'old' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">Старая таблица</button>
                            <button type="button" onclick="setStaffStatsTableMode('new')" class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${staffTableMode !== 'old' ? 'bg-indigo-500/30 text-indigo-200' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">Новая таблица</button>
                           ` : ''}`
                        : '<div class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/5 text-gray-500 border border-white/10">Статистика стаффа доступна с 3 уровня</div>'}
                </div>
            </div>`;

        if (effectiveView === 'stats') {
            const isOldTable = staffTableMode === 'old';
            const staffList = Array.isArray(state.punishments.staffList) ? state.punishments.staffList : [];
            const rolesMap = state.punishments.staffRolesBySid || {};
            const inferRoleFromGroup = (groupRaw) => {
                const g = String(groupRaw || '').trim().toLowerCase();
                if (!g) return '';
                if (g.includes('мл. модер')) return 'ML';
                if (g.includes('модератор')) return 'M';
                if (g.includes('ст. модер')) return 'STM';
                return '';
            };
            const resolveRoleCode = (row) => {
                const sid = String(row?.admin_steamid || '').trim();
                const explicit = String(rolesMap[sid] || '').trim().toUpperCase();
                if (explicit && explicit !== 'AUTO') return explicit;
                return inferRoleFromGroup(row?.group);
            };
            const roleLabelRu = (code) => {
                const c = String(code || '').trim().toUpperCase();
                if (c === 'GA') return 'ГА';
                if (c === 'STA') return 'СТА';
                if (c === 'STM') return 'СТМ';
                if (c === 'M') return 'М';
                if (c === 'ML') return 'МЛ';
                return '—';
            };
            const roleRank = (roleRaw) => {
                const r = String(roleRaw || '').trim().toUpperCase();
                if (r === 'GA') return 0;
                if (r === 'STA') return 1;
                if (r === 'STM') return 2;
                if (r === 'M') return 3;
                if (r === 'ML') return 4;
                return 9;
            };
            const baseRows = staffList.map(s => ({
                admin_steamid: String(s.steamid || ''),
                admin: s.name || '—',
                admin_avatar: s.avatar_full || '',
                group: s.group_display_name || '',
                bans: 0,
                mutes: 0,
                sum: 0
            }));
            const statsRows = (Array.isArray(state.punishments.staffStatsRows) ? state.punishments.staffStatsRows : baseRows)
                .sort((a, b) => {
                    const ra = roleRank(resolveRoleCode(a));
                    const rb = roleRank(resolveRoleCode(b));
                    if (ra !== rb) return ra - rb;
                    return (b.sum || 0) - (a.sum || 0);
                });
            const totalBans = statsRows.reduce((s, r) => s + r.bans, 0);
            const totalMutes = statsRows.reduce((s, r) => s + r.mutes, 0);
            // Старая таблица: r.sum = все записи периода (не только бан+мут), итог по колонке «Сумма».
            const totalSum = statsRows.reduce((s, r) => s + (Number(r.sum) || 0), 0);
            const secure = !!(window.StaffStatsSecure && typeof window.StaffStatsSecure.computePayoutRow === 'function');
            const ticketsMap = state.punishments.staffTicketsBySid || {};
            const payoutRows = secure
                ? statsRows.map(r => window.StaffStatsSecure.computePayoutRow(
                    r,
                    ticketsMap[String(r.admin_steamid)] || 0,
                    rolesMap[String(r.admin_steamid)] || 'AUTO'
                ))
                : [];
            const totalTickets = secure ? payoutRows.reduce((s, r) => s + (r.tickets || 0), 0) : 0;
            const totalPay = secure ? payoutRows.reduce((s, r) => s + (r.pay?.total || 0), 0) : 0;

            content.innerHTML = punishmentsInputHtml + monthSelectHtml + `
                <p class="text-xs text-gray-500 mb-3 max-w-3xl leading-relaxed">${isOldTable
                    ? 'Старая таблица: в период входят <span class="text-gray-400">все наказания</span> — активные и снятые (разбан), любые причины.'
                    : 'Новая таблица: только <span class="text-gray-400">активные и истёкшие</span> наказания; снятые (разбан) и причины вроде «напиши тикет в дс» не входят в сумму и выплаты.'}</p>
                <div class="flex gap-4 mb-4 flex-wrap">
                    <div class="flex-1 min-w-[100px] bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-3 text-center">
                        <div class="text-rose-400 font-bold text-xl">${totalBans}</div>
                        <div class="text-gray-500 text-xs mt-0.5">Банов</div>
                    </div>
                    <div class="flex-1 min-w-[100px] bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-center">
                        <div class="text-amber-400 font-bold text-xl">${totalMutes}</div>
                        <div class="text-gray-500 text-xs mt-0.5">Мутов</div>
                    </div>
                    <div class="flex-1 min-w-[100px] bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 text-center">
                        <div class="text-emerald-400 font-bold text-xl">${totalSum}</div>
                        <div class="text-gray-500 text-xs mt-0.5">${isOldTable ? 'Все наказания (все статусы)' : 'Всего (активно/истек)'}</div>
                    </div>
                    ${secure ? `
                    <div class="flex-1 min-w-[100px] bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-4 py-3 text-center">
                        <div class="text-indigo-300 font-bold text-xl">${totalTickets}</div>
                        <div class="text-gray-500 text-xs mt-0.5">Тикетов (вручную)</div>
                    </div>
                    <div class="flex-1 min-w-[100px] bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-center">
                        <div class="text-white font-bold text-xl">${totalPay}</div>
                        <div class="text-gray-500 text-xs mt-0.5">Итого выплаты (р)</div>
                    </div>` : (!isOldTable ? `
                    <div class="flex-1 min-w-[160px] bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-center">
                        <div class="text-gray-400 font-semibold text-sm">Загрузка модуля выплат…</div>
                        <div class="text-gray-600 text-xs mt-0.5">новая таблица и выплаты — с 4 уровня</div>
                    </div>` : '')}
                </div>
                <div class="flex items-center gap-2 mb-3 flex-wrap">
                    ${Array.isArray(state.punishments.staffStatsRows) ? '<div class="text-xs text-gray-500">Статистика считается с запуска сервера и обновляется каждый час.</div>' : '<div class="text-xs text-gray-500">Загрузка с сервера…</div>'}
                    ${secure ? `<button type="button" onclick="exportStaffStatsCsv()" class="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors">Экспорт Excel (CSV)</button>` : ''}
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                        <thead>
                            <tr class="text-gray-400 border-b border-white/10">
                                <th class="py-3 px-2 font-semibold">#</th>
                                <th class="py-3 px-2 font-semibold">Стаф</th>
                                <th class="py-3 px-2 font-semibold">Должность</th>
                                <th class="py-3 px-2 font-semibold text-rose-400">Баны</th>
                                <th class="py-3 px-2 font-semibold text-amber-400">Муты</th>
                                <th class="py-3 px-2 font-semibold text-emerald-400">Сумма</th>
                                ${secure && !isOldTable ? '<th class="py-3 px-2 font-semibold text-indigo-300">Тикеты</th><th class="py-3 px-2 font-semibold text-white">Выплата</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${statsRows.length === 0
                                ? `<tr><td colspan="${secure && !isOldTable ? 8 : 6}" class="py-6 text-center text-gray-500">Список стафа загружается...</td></tr>`
                                : statsRows.map((r, i) => `
                                <tr class="border-b border-white/5 hover:bg-white/[0.03] row-new">
                                    <td class="py-3 px-2 text-gray-500 font-mono">${i + 1}</td>
                                    <td class="py-3 px-2">
                                        <div class="flex items-center gap-2">
                                            <img src="${(r.admin_avatar || DEFAULT_AVATAR).replace(/^http:\/\//i, 'https://')}" class="w-8 h-8 rounded-full shrink-0" onerror="this.src='${DEFAULT_AVATAR}'">
                                            <div>
                                                <div class="text-white font-medium leading-tight">${escapeHtml(r.admin)}</div>
                                                <div class="text-gray-600 font-mono text-[10px]">${escapeHtml(r.admin_steamid)}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td class="py-3 px-2 text-gray-300 text-xs font-semibold">${escapeHtml(roleLabelRu(resolveRoleCode(r)))}</td>
                                    <td class="py-3 px-2 text-rose-400 font-semibold">${r.bans || '<span class="text-gray-600">0</span>'}</td>
                                    <td class="py-3 px-2 text-amber-400 font-semibold">${r.mutes || '<span class="text-gray-600">0</span>'}</td>
                                    <td class="py-3 px-2 ${r.sum > 0 ? 'text-emerald-400 font-bold' : 'text-gray-600'}">${r.sum}</td>
                                    ${secure && !isOldTable ? (() => {
                                        const sid = String(r.admin_steamid || '');
                                        const cur = (ticketsMap && ticketsMap[sid] != null) ? ticketsMap[sid] : 0;
                                        const pr = window.StaffStatsSecure.computePayoutRow(r, cur, rolesMap[String(r.admin_steamid)] || 'AUTO');
                                        const fixed = pr.pay.fixed || 0;
                                        return `
                                        <td class="py-3 px-2">
                                            <div class="flex items-center gap-2">
                                                <input type="number" min="0" step="1" value="${cur}" data-ticket-sid="${escapeHtml(sid)}" class="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-indigo-500">
                                                <button type="button" onclick="saveStaffTicketsFromInput('${escapeHtml(sid)}')" class="px-2 py-1 text-[11px] font-semibold rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition-colors">OK</button>
                                            </div>
                                            <div class="text-[10px] text-gray-600 mt-1">ставка: ${pr.rates.ticketRate}р</div>
                                        </td>
                                        <td class="py-3 px-2 text-white font-semibold">
                                            ${pr.pay.total}
                                            <div class="text-[10px] text-gray-600 mt-1">б:${pr.pay.bans} м:${pr.pay.mutes} т:${pr.pay.tickets}${fixed ? ` +фикс:${fixed}` : ''}</div>
                                        </td>`;
                                    })() : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else {
            const listBans = displayList.filter(p => p.type === 1).length;
            const listMutes = displayList.filter(p => p.type === 2).length;
            content.innerHTML = punishmentsInputHtml + monthSelectHtml + `
                <div class="flex gap-3 mb-4 flex-wrap">
                    <div class="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                        <span class="text-rose-400 font-bold">${listBans}</span>
                        <span class="text-gray-500 text-xs">банов</span>
                    </div>
                    <div class="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <span class="text-amber-400 font-bold">${listMutes}</span>
                        <span class="text-gray-500 text-xs">мутов</span>
                    </div>
                    <div class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                        <span class="text-white font-bold">${displayList.length}</span>
                        <span class="text-gray-500 text-xs">всего за период</span>
                    </div>
                </div>
                <div class="mb-4">
                    <div class="text-gray-400 text-xs mb-1">Причины (активно/истек):</div>
                    <div class="flex flex-wrap gap-2">
                        ${(visibleReasons.length ? visibleReasons : [['—', 0]]).slice(0, 10).map(([reason, count]) => `
                            <span class="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-gray-300">${escapeHtml(reason)}: <span class="text-white">${count}</span></span>
                        `).join('')}
                    </div>
                </div>
                <div class="mb-4">
                    <div class="text-gray-400 text-xs mb-1">Причины (разбанен):</div>
                    <div class="flex flex-wrap gap-2">
                        ${(unbannedReasons.length ? unbannedReasons : [['—', 0]]).slice(0, 10).map(([reason, count]) => `
                            <span class="px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-xs text-gray-300">${escapeHtml(reason)}: <span class="text-blue-300">${count}</span></span>
                        `).join('')}
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                        <thead>
                            <tr class="text-gray-400 border-b border-white/10">
                                <th class="py-3 px-2 font-semibold">Игрок</th>
                                <th class="py-3 px-2 font-semibold">SteamID</th>
                                <th class="py-3 px-2 font-semibold">Причина</th>
                                <th class="py-3 px-2 font-semibold">Админ</th>
                                <th class="py-3 px-2 font-semibold">Тип</th>
                                <th class="py-3 px-2 font-semibold">Статус</th>
                                <th class="py-3 px-2 font-semibold">Длительность</th>
                                <th class="py-3 px-2 font-semibold">Создано</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${displayList.length === 0
                                ? `<tr><td colspan="8" class="py-6 text-center ${punishmentsError ? 'text-rose-400' : 'text-gray-500'}">${loading ? 'Загрузка наказаний...' : (punishmentsError ? escapeHtml(punishmentsError) : (ownSteamMode ? 'Введите ваш SteamID или SteamID админа и нажмите «Обновить»' : 'Введите SteamID админа и нажмите «Загрузить»'))}</td></tr>`
                                : displayList.map(p => {
                                const st = statusLabel(p.status);
                                return `
                                <tr class="border-b border-white/5 hover:bg-white/[0.03] row-new">
                                    <td class="py-3 px-2">
                                        <div class="flex items-center gap-2">
                                            <img src="${(p.avatar || DEFAULT_AVATAR).replace(/^http:\/\//i, 'https://')}" class="w-8 h-8 rounded-full shrink-0" onerror="this.src='${DEFAULT_AVATAR}'">
                                            <span class="text-white font-medium truncate max-w-[140px]">${escapeHtml(p.name || '—')}</span>
                                        </div>
                                    </td>
                                    <td class="py-3 px-2 font-mono text-gray-400 text-xs">${escapeHtml(String(p.steamid || ''))}</td>
                                    <td class="py-3 px-2 text-gray-300 max-w-[180px] truncate" title="${escapeHtml(p.reason || '')}">${escapeHtml(p.reason || '—')}</td>
                                    <td class="py-3 px-2 text-gray-400">${escapeHtml(p.admin || '—')}</td>
                                    <td class="py-3 px-2"><span class="px-2 py-0.5 rounded text-xs font-medium ${p.type === 1 ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}">${typeLabel(p.type)}</span></td>
                                    <td class="py-3 px-2"><span class="px-2 py-0.5 rounded text-xs font-medium ${st.class}">${st.text}</span></td>
                                    <td class="py-3 px-2 text-gray-400">${formatDuration(p.duration)}</td>
                                    <td class="py-3 px-2 text-gray-500 text-xs">${formatTs(getCreatedTs(p))}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`;
        }
        staggerRows(content);
        return;
    }

    if (cat === 'Лаунчер') {
        title.textContent = 'Для лаунчера';
        const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
            ? window.location.origin
            : '';
        const exampleBase = origin || 'https://ваш-домен';
        const endpointPath = '/api/launcher/players';
        const fullUrl = exampleBase + endpointPath;
        const myKey = String(state.launcherApiKey || '').trim();
        const urlWithToken = myKey ? `${fullUrl}?token=${encodeURIComponent(myKey)}` : '';
        content.innerHTML = `
            <div class="px-1 space-y-5 text-sm text-gray-300 max-w-[720px]">
                <p class="text-gray-400 leading-relaxed">У каждого аккаунта свой <strong class="text-gray-200">личный API-ключ</strong> (один раз создаётся в базе). Его нужно вставить в лаунчер в поле «API-ключ» и передавать в запросе к <code class="text-gray-300">/api/launcher/players</code>.</p>

                <div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div class="text-xs uppercase tracking-wide text-amber-200/90 font-semibold">Ваш API-ключ</div>
                    <p class="text-gray-400 text-xs">Не передавайте ключ третьим лицам. Копируйте после входа на сайт; если пусто — откройте панель ещё раз или обновите страницу.</p>
                    <div class="flex flex-wrap items-center gap-2">
                        <code id="launcherUserKey" class="flex-1 min-w-0 block text-amber-100 bg-black/30 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs break-all">${myKey ? escapeHtml(myKey) : '—'}</code>
                        <button type="button" onclick="copyLauncherDocText('launcherUserKey')" class="shrink-0 px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-xs font-medium border border-amber-500/30">Копировать</button>
                    </div>
                </div>

                <div class="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-3">
                    <div class="text-xs uppercase tracking-wide text-violet-300/90 font-semibold">1. Базовый URL панели</div>
                    <p class="text-gray-400 text-xs">В поле <span class="text-gray-200">«URL панели игроков»</span> в лаунчере — без слэша в конце.</p>
                    <div class="flex flex-wrap items-center gap-2">
                        <code id="launcherDocBase" class="flex-1 min-w-0 block text-violet-200 bg-black/30 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs break-all">${escapeHtml(exampleBase)}</code>
                        <button type="button" onclick="copyLauncherDocText('launcherDocBase')" class="shrink-0 px-3 py-2 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 text-xs font-medium border border-violet-500/30">Копировать</button>
                    </div>
                </div>

                <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                    <div class="text-xs uppercase tracking-wide text-gray-400 font-semibold">2. Запрос к API</div>
                    <p class="text-gray-400 text-xs leading-relaxed">Метод <code class="text-gray-300">GET</code>. Ключ: заголовок <code class="text-gray-300">Authorization: Bearer …</code>, или <code class="text-gray-300">X-API-Key</code>, или параметр <code class="text-gray-300">?token=</code>.</p>
                    <div class="flex flex-wrap items-center gap-2">
                        <code id="launcherDocUrl" class="flex-1 min-w-0 block text-emerald-200/90 bg-black/30 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs break-all">${escapeHtml(fullUrl)}</code>
                        <button type="button" onclick="copyLauncherDocText('launcherDocUrl')" class="shrink-0 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-gray-200 text-xs font-medium border border-white/15">Копировать URL</button>
                    </div>
                    ${urlWithToken ? `<div class="flex flex-wrap items-center gap-2 pt-1">
                        <code id="launcherDocUrlToken" class="flex-1 min-w-0 block text-cyan-200/90 bg-black/30 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs break-all">${escapeHtml(urlWithToken)}</code>
                        <button type="button" onclick="copyLauncherDocText('launcherDocUrlToken')" class="shrink-0 px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-100 text-xs font-medium border border-cyan-500/25">URL с token</button>
                    </div>` : ''}
                </div>

                <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                    <div class="text-xs uppercase tracking-wide text-gray-400 font-semibold">3. Дополнительно на сервере</div>
                    <p class="text-gray-400 text-xs leading-relaxed">Для ботов и CI можно задать общий секрет <code class="text-gray-300">LAUNCHER_API_KEY</code> (или <code class="text-gray-300">LAUNCHER_API_TOKEN</code> / <code class="text-gray-300">MODERATOR_API_TOKEN</code>) — он принимается наряду с личными ключами пользователей.</p>
                </div>
            </div>`;
        return;
    }

    if (cat === 'Проверка') {
        content.innerHTML = `
            <div class="px-1">
                <div class="flex gap-2 mb-4">
                    <input type="text" id="checkInput" placeholder="SteamID игрока" autocomplete="off" class="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors font-mono">
                    <button onclick="runPlayerCheck()" class="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-semibold rounded-lg transition-colors">Проверить</button>
                </div>
                <div id="checkResult" class="text-gray-400 text-sm text-center py-4">Введите SteamID для проверки</div>
            </div>`;
        setTimeout(() => {
            const inp = document.getElementById('checkInput');
            if (inp) {
                inp.focus();
                inp.addEventListener('keydown', e => { if (e.key === 'Enter') runPlayerCheck(); });
            }
        }, 50);
        return;
    }
}

let _renderQueued = false;
function scheduleRenderPanel() {
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(() => {
        _renderQueued = false;
        renderPanel();
        const panel = document.getElementById('panelContent');
        if (panel) initUiSelects(panel);
    });
}

function toggleMonthDropdown() {
    const list = document.getElementById('monthDropdownList');
    const trigger = document.querySelector('#monthDropdownWrap .ui-select-trigger');
    if (list) list.classList.toggle('hidden');
    if (trigger && list) trigger.classList.toggle('open', !list.classList.contains('hidden'));
}

document.addEventListener('click', function _monthClose(e) {
    const wrap = document.getElementById('monthDropdownWrap');
    const list = document.getElementById('monthDropdownList');
    if (wrap && list && !wrap.contains(e.target)) {
        list.classList.add('hidden');
        const trigger = wrap.querySelector('.ui-select-trigger');
        if (trigger) trigger.classList.remove('open');
    }
});

document.addEventListener('click', (e) => {
    if (e.target.closest('.ui-select-menu') || e.target.closest('.ui-select-trigger')) return;
    closeUiSelectMenu();
});

function setPunishmentsMonth(value) {
    const list = document.getElementById('monthDropdownList');
    if (list) list.classList.add('hidden');
    const trigger = document.querySelector('#monthDropdownWrap .ui-select-trigger');
    if (trigger) trigger.classList.remove('open');
    state.punishments.selectedMonth = value || null;
    state.punishments.statsPeriodMode = 'month';
    state.punishments.selectedWeekStart = null;
    if (state.punishments.view === 'stats') {
        loadStaffTicketsForSelectedMonth();
        state.punishments.staffStatsRows = null;
        if (Array.isArray(state.punishments.staffList) && Object.keys(state.punishments.staffStatsData || {}).length > 0) {
            state.punishments.staffStatsRows = computeStaffStatsRows(
                state.punishments.staffList,
                state.punishments.staffStatsData,
                state.punishments.selectedMonth
            );
        }
    }
    scheduleRenderPanel();
}

function setPunishmentsWeekStart(startYmd) {
    const s = String(startYmd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return;
    const list = document.getElementById('monthDropdownList');
    if (list) list.classList.add('hidden');
    const trigger = document.querySelector('#monthDropdownWrap .ui-select-trigger');
    if (trigger) trigger.classList.remove('open');
    state.punishments.statsPeriodMode = 'week';
    state.punishments.selectedWeekStart = s;
    state.punishments.staffStatsRows = null;
    if (state.punishments.view === 'stats') {
        if (Array.isArray(state.punishments.staffList) && Object.keys(state.punishments.staffStatsData || {}).length > 0) {
            state.punishments.staffStatsRows = computeStaffStatsRows(
                state.punishments.staffList,
                state.punishments.staffStatsData,
                state.punishments.selectedMonth
            );
        }
        scheduleRenderPanel();
    }
}

function setPunishmentsView(view) {
    if (view === 'stats' && getUserLevel() < 3) {
        state.punishments.view = 'list';
        scheduleRenderPanel();
        return;
    }
    state.punishments.view = view;
    scheduleRenderPanel();
    if (view === 'stats') {
        // Уровень 3: только старая таблица, без secure-модуля и API выплат/тикетов.
        if (getUserLevel() === 3) {
            state.punishments.staffTableMode = 'old';
            loadStaffStatsFromServer();
        } else {
            ensureStaffSecureLoaded().then(() => {
                loadStaffPayConfig();
                loadStaffStatsFromServer();
                loadStaffRoles();
                loadStaffTicketsForSelectedMonth();
            });
        }
    }
}

async function ensureStaffSecureLoaded() {
    if (state.punishments.secureLoaded) return true;
    if (getUserLevel() < 4) return false;
    try {
        const res = await apiFetch('/secure/staff-stats-secure.js');
        if (!res.ok) return false;
        const js = await res.text();
        const s = document.createElement('script');
        s.text = js;
        document.head.appendChild(s);
        state.punishments.secureLoaded = !!(window.StaffStatsSecure && typeof window.StaffStatsSecure.computeStaffStatsRowsSecure === 'function');
        return state.punishments.secureLoaded;
    } catch (_) {
        return false;
    }
}

async function loadStaffPayConfig() {
    if (getUserLevel() < 4) return;
    try {
        const res = await apiFetch('/api/staff-pay-config');
        if (!res.ok) return;
        const cfg = await res.json().catch(() => ({}));
        if (window.StaffStatsSecure && typeof window.StaffStatsSecure.setConfig === 'function') {
            window.StaffStatsSecure.setConfig(cfg);
        }
        state.punishments.staffPayConfig = cfg || {};
    } catch (_) {}
}

function getEffectiveYm(selectedMonth) {
    if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) return selectedMonth;
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

async function loadStaffTicketsForSelectedMonth() {
    if (getUserLevel() < 4) return;
    const ym = getEffectiveYm(state.punishments.selectedMonth);
    if (state.punishments.staffTicketsLoading && state.punishments.staffTicketsYm === ym) return;
    state.punishments.staffTicketsLoading = true;
    state.punishments.staffTicketsYm = ym;
    try {
        const res = await apiFetch('/api/staff-tickets?ym=' + encodeURIComponent(ym));
        if (res.status === 403) return;
        const data = await res.json().catch(() => ({}));
        const map = {};
        (Array.isArray(data.tickets) ? data.tickets : []).forEach(r => {
            const sid = String(r.steam_id || '').trim();
            if (sid) map[sid] = parseInt(r.tickets, 10) || 0;
        });
        state.punishments.staffTicketsBySid = map;
    } catch (_) {
        state.punishments.staffTicketsBySid = {};
    } finally {
        state.punishments.staffTicketsLoading = false;
        if (state.openCategory === 'Наказания') scheduleRenderPanel();
    }
}

async function loadStaffRoles() {
    if (getUserLevel() < 4) return;
    if (state.punishments.staffRolesLoading) return;
    state.punishments.staffRolesLoading = true;
    try {
        const res = await apiFetch('/api/staff-roles');
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const map = {};
        (Array.isArray(data.roles) ? data.roles : []).forEach(r => {
            const sid = String(r.steam_id || '').trim();
            const role = String(r.role || '').trim().toUpperCase();
            if (sid && role) map[sid] = role;
        });
        state.punishments.staffRolesBySid = map;
    } catch (_) {
        state.punishments.staffRolesBySid = {};
    } finally {
        state.punishments.staffRolesLoading = false;
        if (state.openCategory === 'Наказания') scheduleRenderPanel();
    }
}

async function saveStaffTickets(steamId, tickets) {
    if (getUserLevel() < 4) return;
    const ym = getEffectiveYm(state.punishments.selectedMonth);
    try {
        const res = await apiFetch('/api/staff-tickets?ym=' + encodeURIComponent(ym), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steamId, tickets })
        });
        if (!res.ok) return;
        state.punishments.staffTicketsBySid = { ...(state.punishments.staffTicketsBySid || {}), [String(steamId)]: parseInt(tickets, 10) || 0 };
        if (state.openCategory === 'Наказания') scheduleRenderPanel();
    } catch (_) {}
}

function saveStaffTicketsFromInput(steamId) {
    const sid = String(steamId || '').trim();
    if (!sid) return;
    const inp = document.querySelector(`input[data-ticket-sid="${CSS.escape(sid)}"]`);
    const val = inp ? inp.value : '0';
    saveStaffTickets(sid, parseInt(val, 10) || 0);
}

function exportStaffStatsCsv() {
    if (!(window.StaffStatsSecure && typeof window.StaffStatsSecure.toCsv === 'function')) return;
    const rows = Array.isArray(state.punishments.staffStatsRows) ? state.punishments.staffStatsRows : [];
    const map = state.punishments.staffTicketsBySid || {};
    const roles = state.punishments.staffRolesBySid || {};
    // Для недельного режима в CSV не включаем выплаты (тикеты/роль/нормы привязаны к месяцу).
    if (state?.punishments?.statsPeriodMode === 'week') {
        const csv = window.StaffStatsSecure.toCsv(rows.map(r => ({ ...r, tickets: 0, rates: { banRate: 0, muteRate: 0, ticketRate: 0 }, pay: { bans: 0, mutes: 0, tickets: 0, fixed: 0, total: 0 } })));
        const ymd = String(state.punishments.selectedWeekStart || '').trim() || 'week';
        window.StaffStatsSecure.downloadCsv(`staff-stats-week-${ymd}.csv`, csv);
        return;
    }
    const payout = rows.map(r => window.StaffStatsSecure.computePayoutRow(r, map[String(r.admin_steamid)] || 0, roles[String(r.admin_steamid)] || 'AUTO'));
    const ym = getEffectiveYm(state.punishments.selectedMonth);
    const csv = window.StaffStatsSecure.toCsv(payout);
    window.StaffStatsSecure.downloadCsv(`staff-stats-${ym}.csv`, csv);
}

function setStaffStatsTableMode(mode) {
    if (getUserLevel() === 3) return;
    const m = mode === 'old' ? 'old' : 'new';
    state.punishments.staffTableMode = m;
    if (state.openCategory === 'Наказания' && state.punishments.view === 'stats') {
        if (Array.isArray(state.punishments.staffList) && Object.keys(state.punishments.staffStatsData || {}).length > 0) {
            state.punishments.staffStatsRows = computeStaffStatsRows(
                state.punishments.staffList,
                state.punishments.staffStatsData,
                state.punishments.selectedMonth
            );
        }
        scheduleRenderPanel();
    }
}

async function loadStaffStatsFromServer() {
    if (getUserLevel() < 3) return;
    if (getUserLevel() >= 4) await ensureStaffSecureLoaded();
    try {
        let res = await apiFetch('/api/punishments/staff-stats');
        if (res.status === 403) return;
        let data = await res.json().catch(() => ({}));
        if (!data.lastUpdated || !data.staffStatsData || Object.keys(data.staffStatsData || {}).length === 0) {
            const retry = await apiFetch('/api/punishments/staff-stats?force=1');
            if (retry.ok) {
                data = await retry.json().catch(() => data);
            }
        }
        const staffList = Array.isArray(data.staffList) && data.staffList.length > 0
            ? data.staffList
            : (state.punishments.staffList || []);
        state.punishments.staffList = staffList;
        state.punishments.staffStatsData = data.staffStatsData || {};
        state.punishments.staffStatsRows = computeStaffStatsRows(
            staffList,
            state.punishments.staffStatsData,
            state.punishments.selectedMonth
        );
        if (state.openCategory === 'Наказания') scheduleRenderPanel();
    } catch (_) {}
}

async function loadPunishmentsStaffList() {
    if (Array.isArray(state.punishments.staffList)) {
        if (state.punishments.view === 'stats') loadStaffStatsFromServer();
        return;
    }
    try {
        // Берем список стаффа из статического файла.
        // Сервер обновляет `public/data/staff.json` раз в 24 часа после запуска.
        const data = await fetch('/data/staff.json').then(r => r.ok ? r.json() : []).catch(() => []);
        state.punishments.staffList = Array.isArray(data) ? data : [];
    } catch (_) {
        state.punishments.staffList = [];
    }
    if (state.openCategory === 'Наказания') {
        scheduleRenderPanel();
        if (state.punishments.view === 'stats') loadStaffStatsFromServer();
    }
}

function computeStaffStatsRows(staffList, statsDataBySid, selectedMonth) {
    const isOldTable = state?.punishments?.staffTableMode === 'old' || getUserLevel() === 3;
    // Один и тот же период (месяц или неделя) для обеих таблиц; отличаются только фильтры строк.
    const period = (state?.punishments?.statsPeriodMode === 'week' && state?.punishments?.selectedWeekStart)
        ? ('week:' + String(state.punishments.selectedWeekStart))
        : selectedMonth;
    // Старая: все записи в периоде — любой статус, любая причина (computeStaffStatsRowsOld).
    // Новая: только 1/4 и без «тикет в дс» и т.п. (computeStaffStatsRowsSecure).
    if (isOldTable && window.StaffStatsSecure && typeof window.StaffStatsSecure.computeStaffStatsRowsOld === 'function') {
        return window.StaffStatsSecure.computeStaffStatsRowsOld(staffList, statsDataBySid, period);
    }
    if (!isOldTable && window.StaffStatsSecure && typeof window.StaffStatsSecure.computeStaffStatsRowsSecure === 'function') {
        return window.StaffStatsSecure.computeStaffStatsRowsSecure(staffList, statsDataBySid, period);
    }
    const list = Array.isArray(staffList) ? staffList : [];
    if (isOldTable) {
        return list.map((s) => {
            const sid = String(s.steamid || '');
            const arr = Array.isArray(statsDataBySid?.[sid]) ? statsDataBySid[sid] : [];
            const scoped = period ? arr.filter((p) => punishmentInSelectedPeriod(p, period)) : arr;
            const bans = scoped.filter((p) => Number(p?.type) === 1).length;
            const mutes = scoped.filter((p) => Number(p?.type) === 2).length;
            return {
                admin_steamid: sid,
                admin: s.name || '—',
                admin_avatar: s.avatar_full || '',
                group: s.group_display_name || '',
                bans,
                mutes,
                sum: scoped.length
            };
        }).sort((a, b) => (b.sum || 0) - (a.sum || 0));
    }
    return list.map((s) => {
        const sid = String(s.steamid || '');
        const arr = Array.isArray(statsDataBySid?.[sid]) ? statsDataBySid[sid] : [];
        const scoped = period ? arr.filter((p) => punishmentInSelectedPeriod(p, period)) : arr;
        const counted = scoped.filter((p) => {
            const st = staffStatsPunishmentStatus(p);
            if (!(st === 1 || st === 4)) return false;
            if (isStaffStatsExcludedReason(staffStatsPunishmentReason(p))) return false;
            return true;
        });
        const bans = counted.filter((p) => Number(p?.type) === 1).length;
        const mutes = counted.filter((p) => Number(p?.type) === 2).length;
        return {
            admin_steamid: sid,
            admin: s.name || '—',
            admin_avatar: s.avatar_full || '',
            group: s.group_display_name || '',
            bans,
            mutes,
            sum: bans + mutes
        };
    }).sort((a, b) => (b.sum || 0) - (a.sum || 0));
}

async function loadStaffBansStats() {
    await loadPunishmentsStaffList();
    const staffList = Array.isArray(state.punishments.staffList) ? state.punishments.staffList : [];
    if (staffList.length === 0) {
        state.punishments.staffStatsRows = [];
        scheduleRenderPanel();
        return;
    }
    state.punishments.staffStatsLoading = true;
    state.punishments.staffStatsProgress = { done: 0, total: staffList.length };
    scheduleRenderPanel();
    try {
        const statsDataBySid = { ...(state.punishments.staffStatsData || {}) };
        for (let i = 0; i < staffList.length; i++) {
            const s = staffList[i];
            const sid = String(s.steamid || '');
            if (sid) {
                let loaded = false;
                for (let attempt = 1; attempt <= 4; attempt++) {
                    try {
                        const res = await apiFetch('/api/punishments?steamId=' + encodeURIComponent(sid));
                        if (res.status === 429) {
                            await sleep(900 * attempt);
                            continue;
                        }
                        const data = await res.json().catch(() => ({ punishments: [] }));
                        statsDataBySid[sid] = Array.isArray(data.punishments) ? data.punishments : [];
                        loaded = true;
                        break;
                    } catch (_) {
                        await sleep(400 * attempt);
                    }
                }
                if (!loaded && !statsDataBySid[sid]) statsDataBySid[sid] = [];
            }
            state.punishments.staffStatsData = statsDataBySid;
            state.punishments.staffStatsRows = computeStaffStatsRows(
                staffList,
                statsDataBySid,
                state.punishments.selectedMonth
            );
            state.punishments.staffStatsProgress = { done: i + 1, total: staffList.length };
            scheduleRenderPanel();
            await sleep(180);
        }
    } catch (_) {
        state.punishments.staffStatsRows = [];
    } finally {
        state.punishments.staffStatsLoading = false;
        state.punishments.staffStatsProgress = null;
        scheduleRenderPanel();
    }
}

async function loadPunishmentsBySteamId() {
    const inp = document.getElementById('punishmentsSteamIdInput');
    const raw = (((inp && inp.value) || '').trim()) || (state.userSteamId || '');
    const steamId = raw.replace(/\D/g, '');
    if (steamId.length < 5) {
        if (inp) inp.focus();
        return;
    }
    const now = Date.now();
    const sameSteamId = String(state.punishments.lastSteamId || '') === steamId;
    if (sameSteamId && state.punishments.lastLoadedAt && (now - state.punishments.lastLoadedAt) < 10000) {
        return;
    }
    if (inp) inp.value = steamId;
    state.punishments.loading = true;
    state.punishments.error = '';
    state.punishments.lastSteamId = steamId;
    state.punishments.selectedMonth = null;
    state.punishments.view = 'list';
    scheduleRenderPanel();
    try {
        const res = await apiFetch('/api/punishments?steamId=' + encodeURIComponent(steamId));
        if (res.status === 403) {
            const err = await res.json().catch(() => ({}));
            state.punishments = {
                ...state.punishments,
                count: 0,
                list: [],
                loading: false,
                lastSteamId: steamId,
                selectedMonth: null,
                view: 'list',
                error: err?.error || 'Доступ запрещен',
                lastLoadedAt: Date.now(),
                lastSource: 'error'
            };
            renderCounts();
            scheduleRenderPanel();
            return;
        }
        const d = await res.json().catch(() => ({ count: 0, punishments: [] }));
        state.punishments = { ...state.punishments, count: d.count || 0, list: Array.isArray(d.punishments) ? d.punishments : [], loading: false, lastSteamId: steamId, selectedMonth: null, view: 'list', lastLoadedAt: Date.now(), lastSource: d.source || 'api' };
    } catch (_) {
        state.punishments.loading = false;
    }
    renderCounts();
    scheduleRenderPanel();
}

function buildVacTable(players) {
    const canWhitelist = state.userLevel >= 1;
    return `
        <div class="overflow-x-auto hide-scrollbar">
            <table class="w-full"><tbody>
                ${players.map((p, i) => {
                    const sid = String(p.SteamId ?? '');
                    const nick = escapeForOnclick(p.nickname || 'Unknown');
                    const rCnt = getPlayerReportCount(sid);
                    const rBadge = `<span data-report-sid="${sid}" class="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-bold rounded-full" style="display:${rCnt > 0 ? '' : 'none'}">${rCnt}</span>`;
                    const fBadge = faceitLevelBadgeHtml(sid);
                    return `
                            <tr class="border-b border-white/[0.04] hover:bg-white/[0.03]">
                        <td class="py-3 px-3 text-white text-sm font-bold w-12">${i + 1}</td>
                                <td class="py-3 px-3">
                                    <div class="flex items-center gap-3">
                                <img src="${p.avatar || DEFAULT_AVATAR}" alt="${p.nickname || 'Player'}" class="w-9 h-9 rounded-full" onerror="this.src='${DEFAULT_AVATAR}'">
                                        <div class="min-w-0">
                                    <div class="flex items-center gap-1"><span class="text-white text-sm font-semibold truncate">${p.nickname || 'Unknown'}</span>${fBadge}${rBadge}</div>
                                    <div class="text-gray-500 text-xs font-mono">${p.SteamId}</div>
                                        </div>
                                    </div>
                                </td>
                        <td class="py-3 px-3 text-rose-400 text-sm font-bold whitespace-nowrap">Game банов: ${p.NumberOfGameBans}</td>
                        <td class="py-3 px-3 text-gray-400 text-xs min-w-[8rem] w-[8rem]">
                            <div class="flex flex-col">
                                <span class="whitespace-nowrap">${p.DaysSinceLastBan} дней назад</span>
                                <span id="acc-age-${sid}" class="text-gray-500 mt-0.5">...</span>
                            </div>
                                </td>
                                <td class="py-3 px-3">
                                    <div class="flex gap-2">
                                ${canWhitelist ? `<button onclick="addToWhitelist('${sid}', '${nick}')" class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg">Чист</button>` : ''}
                                <a href="https://fearproject.ru/profile/${sid}" target="_blank" class="px-3 py-1.5 bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold rounded-lg">FEAR</a>
                                <a href="https://steamcommunity.com/profiles/${sid}" target="_blank" class="px-3 py-1.5 bg-[#171a21] hover:bg-[#1b2838] text-white text-xs font-semibold rounded-lg">Steam</a>
                                <button onclick="requestPlayerGames('${sid}')" class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg">Игры</button>
                                    </div>
                            <div id="games-${sid}" class="text-xs text-gray-400 mt-1"></div>
                                </td>
                    </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

function buildYoomaTable(players) {
    const canWhitelist = state.userLevel >= 1;
    const sorted = [...players].sort((a, b) => (b.created || 0) - (a.created || 0));
    return `
        <div class="overflow-x-auto hide-scrollbar">
            <table class="w-full"><tbody>
                ${sorted.map((p, i) => {
                    const daysAgo = Math.floor((Date.now() / 1000 - (p.created || 0)) / 86400);
                            const daysText = daysAgo === 0 ? 'Сегодня' : `${daysAgo} ${daysAgo === 1 ? 'день' : daysAgo < 5 ? 'дня' : 'дней'} назад`;
                    let reason = (p.reason || '').trim();
                    if (reason.includes('Haron Anti-Cheat')) reason = 'AC';
                    else if (reason.includes('Использование читов') || reason.includes('использование читов')) reason = 'Читы';
                    else if (reason.includes('Отказ от проверки')) reason = 'Отказ';
                    else if (/игрок не/i.test(reason)) reason = 'Отказ';
                    else if (/отказ/i.test(reason)) reason = 'Отказ';
                    else if (/обход/i.test(reason)) reason = 'Обход';
                    else if (/самопризнан/i.test(reason)) reason = 'Признание';
                    else if (reason.length > 15) reason = reason.substring(0, 15) + '…';
                    const sid = String(p.steamId ?? '');
                    const nick = escapeForOnclick(p.nickname || 'Unknown');
                    const reportCnt = getPlayerReportCount(sid);
                    const reportBadge = `<span data-report-sid="${sid}" class="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-bold rounded-full" style="display:${reportCnt > 0 ? '' : 'none'}">${reportCnt}</span>`;
                    const created = p.created ? new Date(p.created * 1000).toLocaleDateString('ru') : '';
                    const fBadge = faceitLevelBadgeHtml(sid);
                            return `
                            <tr class="border-b border-white/[0.04] hover:bg-white/[0.03]">
                        <td class="py-3 px-3 text-white text-sm font-bold w-12">${i + 1}</td>
                                <td class="py-3 px-3">
                                    <div class="flex items-center gap-3">
                                <img src="${p.avatar || DEFAULT_AVATAR}" alt="${p.nickname || 'Player'}" class="w-9 h-9 rounded-full" onerror="this.src='${DEFAULT_AVATAR}'">
                                        <div class="min-w-0">
                                    <div class="flex items-center gap-1"><span class="text-white text-sm font-semibold truncate">${p.nickname || 'Unknown'}</span>${fBadge}${reportBadge}</div>
                                    <div class="text-gray-500 text-xs font-mono">${p.steamId}</div>
                                        </div>
                                    </div>
                                </td>
                        <td class="py-3 px-3 text-indigo-400 text-sm font-semibold whitespace-nowrap">${reason || '—'}</td>
                        <td class="py-3 px-3 text-gray-400 text-xs min-w-[8rem] w-[8rem]">
                            <div class="flex flex-col">
                                <span class="whitespace-nowrap">${daysText}</span>
                                <span class="text-gray-600 text-[10px]">${created}</span>
                                <span id="acc-age-${sid}" class="text-gray-500 mt-0.5">...</span>
                            </div>
                                </td>
                                <td class="py-3 px-3">
                            <div class="flex gap-2 flex-wrap">
                                ${canWhitelist ? `<button onclick="addToWhitelist('${sid}', '${nick}')" class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg">Чист</button>` : ''}
                                <a href="https://fearproject.ru/profile/${sid}" target="_blank" class="px-3 py-1.5 bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold rounded-lg">FEAR</a>
                                <a href="https://steamcommunity.com/profiles/${sid}" target="_blank" class="px-3 py-1.5 bg-[#171a21] hover:bg-[#1b2838] text-white text-xs font-semibold rounded-lg">Steam</a>
                                    </div>
                                </td>
                    </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

function getSuspiciousFilters() {
    try { return JSON.parse(localStorage.getItem('suspiciousFilters') || '[]'); } catch { return []; }
}
function setSuspiciousFilters(arr) {
    localStorage.setItem('suspiciousFilters', JSON.stringify(arr));
}

const SUSPICIOUS_FILTER_SOURCES = [
    { key: 'hasDXDCS', label: 'DXD', icon: '/images/dxdcs2.ico', color: 'red', activeClass: 'bg-red-500/25 text-red-400 ring-1 ring-red-500/40', inactiveClass: 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]' },
    { key: 'hasVAC', label: 'VAC', icon: '/images/valve.ico', color: 'amber', activeClass: 'bg-amber-500/25 text-amber-400 ring-1 ring-amber-500/40', inactiveClass: 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]' },
    { key: 'hasYooma', label: 'Yooma', icon: '/images/yooma-logo.png', color: 'purple', activeClass: 'bg-purple-500/25 text-purple-400 ring-1 ring-purple-500/40', inactiveClass: 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]' },
    { key: 'hasCS2Red', label: 'CS2Red', icon: '/images/cs2red.ico', color: 'cyan', activeClass: 'bg-cyan-500/25 text-cyan-400 ring-1 ring-cyan-500/40', inactiveClass: 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]' },
    { key: 'hasDeti00', label: 'Deti00', icon: '/images/deti00.ico', color: 'teal', activeClass: 'bg-teal-500/25 text-teal-400 ring-1 ring-teal-500/40', inactiveClass: 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]' },
    { key: 'hasPrideCS2', label: 'Pride', icon: '/images/pridecs2.ico', color: 'orange', activeClass: 'bg-orange-500/25 text-orange-400 ring-1 ring-orange-500/40', inactiveClass: 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]' },
    { key: 'hasTop2', label: 'Top2', icon: '/images/top2.ico', color: 'lime', activeClass: 'bg-lime-500/25 text-lime-400 ring-1 ring-lime-500/40', inactiveClass: 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]' }
];

function filterSuspiciousPlayers(players) {
    const filters = getSuspiciousFilters();
    if (filters.length === 0) return players;
    return players.filter(p => filters.every(f => p[f]));
}

function sortSuspiciousPlayers(players) {
    const sortMethod = localStorage.getItem('suspiciousSortMethod') || 'kills';
    let sorted = filterSuspiciousPlayers([...players]);
    if (sortMethod === 'kills') sorted.sort((a, b) => (b.kills || 0) - (a.kills || 0));
    else if (sortMethod === 'kd') {
        sorted.sort((a, b) => {
                const kdA = (a.deaths || 0) > 0 ? (a.kills || 0) / (a.deaths || 0) : (a.kills || 0);
                const kdB = (b.deaths || 0) > 0 ? (b.kills || 0) / (b.deaths || 0) : (b.kills || 0);
                return kdB - kdA;
            });
    } else if (sortMethod === 'flags') {
        sorted.sort((a, b) => {
            const f = (x) => (x.hasDXDCS ? 1 : 0) + (x.hasVAC ? 1 : 0) + (x.hasYooma ? 1 : 0) + (x.hasCS2Red ? 1 : 0) + (x.hasDeti00 ? 1 : 0) + (x.hasPrideCS2 ? 1 : 0) + (x.hasTop2 ? 1 : 0);
            return f(b) - f(a);
        });
    }
    return { sorted, sortMethod };
}

function serverGameIconHtml(game) {
    const g = String(game || '').trim().toUpperCase();
    // Если бэк ещё не прислал serverGame (старый кэш/сервер без обновления),
    // показываем CS2 по умолчанию, чтобы иконка была всегда.
    if (!g) return `<img src="/images/cs2.ico" class="w-3.5 h-3.5 inline-block" alt="CS2" title="CS2">`;
    const isCsgo = g.includes('CSGO') || g.includes('CS:GO');
    const isCs2 = g.includes('CS2') || g.includes('CS 2');
    if (!isCsgo && !isCs2) return `<img src="/images/cs2.ico" class="w-3.5 h-3.5 inline-block" alt="CS2" title="CS2">`;
    const src = isCsgo ? '/images/csgo.ico' : '/images/cs2.ico';
    const label = isCsgo ? 'CS:GO' : 'CS2';
    return `<img src="${src}" class="w-3.5 h-3.5 inline-block" alt="${label}" title="${label}">`;
}

function buildSuspiciousRowHtml(p, index) {
    const kills = p.kills || 0;
    const deaths = p.deaths || 0;
                            const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
    const flags = [];
    if (p.hasDXDCS) {
        let r = (p.reason || '');
        if (/AntiDLL/i.test(r)) r = 'AC';
        else if (/Haron Anti-Cheat/i.test(r)) r = 'AC';
        else if (/RAC/i.test(r) || r.includes('[i:')) r = 'AC';
        else if (/отказ|не указал/i.test(r)) r = 'Отказ';
        else if (/самопризнан/i.test(r)) r = 'Признание';
        else if (/чит/i.test(r)) r = 'Читы';
        else if (r.length > 12) r = r.substring(0, 12) + '…';
        flags.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/15 text-red-400 text-xs font-semibold"><img src="/images/dxdcs2.ico" class="w-3.5 h-3.5">${r || 'DXD'}</span>`);
    }
    if (p.hasVAC) flags.push('<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-xs font-semibold"><img src="/images/valve.ico" class="w-3.5 h-3.5">VAC</span>');
    if (p.hasYooma) {
        let r = (p.yoomaReason || '').trim();
        if (r.includes('Haron Anti-Cheat')) r = 'AC';
        else if (/AntiDLL/i.test(r)) r = 'AC';
        else if (/отказ/i.test(r)) r = 'Отказ';
        else if (/обход/i.test(r)) r = 'Обход';
        else if (/самопризнан/i.test(r)) r = 'Признание';
        else if (/использован.*чит|чит/i.test(r)) r = 'Читы';
        else if (r.length > 8) r = r.substring(0, 8) + '…';
        flags.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 text-xs font-semibold"><img src="/images/yooma-logo.png" class="w-3.5 h-3.5">${r || 'Yooma'}</span>`);
    }
    if (p.hasCS2Red) {
        flags.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400 text-xs font-semibold"><img src="/images/cs2red.ico" class="w-3.5 h-3.5">${cs2redReason(p.cs2redReason)}</span>`);
    }
    if (p.hasDeti00) {
        flags.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-500/15 text-teal-400 text-xs font-semibold"><img src="/images/deti00.ico" class="w-3.5 h-3.5">${deti00Reason(p.deti00Reason)}</span>`);
    }
    if (p.hasPrideCS2) {
        let r = (p.pridecs2Reason || '').trim();
        if (/отказ/i.test(r)) r = 'Отказ';
        else if (/использован.*чит|чит/i.test(r)) r = 'Читы';
        else if (/обход/i.test(r)) r = 'Обход';
        else if (/самопризнан/i.test(r)) r = 'Признание';
        else if (/AntiDLL|Anti-Cheat|RAC/i.test(r)) r = 'AC';
        else if (r.length > 8) r = r.substring(0, 8) + '…';
        flags.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-500/15 text-orange-400 text-xs font-semibold"><img src="/images/pridecs2.ico" class="w-3.5 h-3.5">${r || 'Pride'}</span>`);
    }
    if (p.hasTop2) {
        let r = (p.top2Reason || '').trim();
        if (/отказ/i.test(r)) r = 'Отказ';
        else if (/игрок не/i.test(r)) r = 'Отказ';
        else if (/использован.*чит|чит/i.test(r)) r = 'Читы';
        else if (/обход/i.test(r)) r = 'Обход';
        else if (/самопризнан/i.test(r)) r = 'Признание';
        else if (/AntiDLL|Anti-Cheat|RAC/i.test(r)) r = 'AC';
        else if (/читерств/i.test(r)) r = 'Читы';
        else if (r.length > 8) r = r.substring(0, 8) + '…';
        flags.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-lime-500/15 text-lime-400 text-xs font-semibold"><img src="/images/top2.ico" class="w-3.5 h-3.5">${r || 'Top2'}</span>`);
    }
    const flagsHtml = flags.join(' ');
    const sid = String(p.steamId ?? '');
    const nick = escapeForOnclick(p.nickname || 'Unknown');
    const serverName = String(p.serverName || '').trim();
    const serverIp = String(p.serverIp || '').trim();
    const serverPort = Number(p.serverPort);
    const canConnect = Boolean(serverName && serverIp && Number.isFinite(serverPort) && serverPort > 0);
    const connectBtnHtml = canConnect
        ? `<a href="steam://connect/${encodeURIComponent(serverIp)}:${serverPort}" class="shrink-0 w-[150px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 text-[10px] font-semibold transition-colors" title="Подключиться к ${escapeHtml(serverName)}"><span class="inline-flex items-center gap-1 w-full">${serverGameIconHtml(p.serverGame)}<span class="truncate">${escapeHtml(serverName)}</span></span></a>`
        : '';
    const rCnt = getPlayerReportCount(sid);
    const rBadge = `<span data-report-sid="${sid}" class="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-bold rounded-full" style="display:${rCnt > 0 ? '' : 'none'}">${rCnt}</span>`;
    const fBadge = faceitLevelBadgeHtml(sid);
    const vis = getPlayersTableColumns();
    const cells = [];
    if (vis.num) cells.push(`<td data-column="num" class="py-3 px-3 text-white text-sm font-bold w-12">${index + 1}</td>`);
    if (vis.player) cells.push(`<td data-column="player" class="py-3 px-3"><div class="flex items-center gap-3"><img src="${p.avatar || DEFAULT_AVATAR}" alt="${p.nickname || 'Player'}" class="w-9 h-9 rounded-full" onerror="this.src='${DEFAULT_AVATAR}'"><div class="min-w-0"><div class="flex items-center gap-1"><span class="text-white text-sm font-semibold truncate">${p.nickname || 'Unknown'}</span>${fBadge}${rBadge}</div><div class="mt-0.5 flex items-center gap-2"><div class="text-gray-500 text-xs font-mono truncate">${p.steamId}</div>${connectBtnHtml}</div></div></div></td>`);
    if (vis.flags) cells.push(`<td data-column="flags" class="py-3 px-2"><div class="flex gap-1 flex-wrap">${flagsHtml}</div></td>`);
    if (vis.kd) cells.push(`<td data-column="kd" class="py-3 px-2"><div class="text-gray-400 text-xs font-semibold">${kd} <span class="text-gray-500">(${kills}/${deaths})</span></div></td>`);
    if (vis.accDate) cells.push(`<td data-column="accDate" class="py-3 px-2"><span id="acc-age-${sid}" class="text-gray-500 text-xs">...</span></td>`);
    const canAdd = state.userLevel >= 1 && !p.whitelisted;
    const canRemove = p.whitelisted && (state.userLevel >= 3 || (p.whitelistAddedBy != null && String(p.whitelistAddedBy) === String(state.userId)));
    const whitelistBtn = canAdd ? `<button onclick="addToWhitelist('${sid}', '${nick}')" class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg">Чист</button>` : (canRemove ? `<button onclick="removeFromWhitelist('${sid}', '${nick}')" class="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold rounded-lg">Убрать</button>` : '');
    if (vis.actions) cells.push(`<td data-column="actions" class="py-3 px-3"><div class="flex gap-2 flex-wrap">${whitelistBtn}<a href="https://fearproject.ru/profile/${sid}" target="_blank" class="px-3 py-1.5 bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold rounded-lg">FEAR</a><a href="https://steamcommunity.com/profiles/${sid}" target="_blank" class="px-3 py-1.5 bg-[#171a21] hover:bg-[#1b2838] text-white text-xs font-semibold rounded-lg">Steam</a><button type="button" data-open-card="${sid}" onmouseenter="prefetchCheck('${sid}')" class="px-3 py-1.5 bg-indigo-500/80 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg btn-card">Карточка</button></div></td>`);
    return `<tr data-sid="${sid}" class="border-b border-white/[0.04] hover:bg-white/[0.03]">${cells.join('')}</tr>`;
}

function sortAndFilterAllPlayers(players) {
    const afterExclusions = applyPlayersExclusions(players);
    const afterCustom = applyCustomFilters(afterExclusions);
    const afterBanFilters = filterSuspiciousPlayers(afterCustom);
    const afterHide = applyHideFilters(afterBanFilters);
    const sortMethod = localStorage.getItem('suspiciousSortMethod') || 'kills';
    const sorted = [...afterHide];
    if (sortMethod === 'kills') sorted.sort((a, b) => (b.kills || 0) - (a.kills || 0));
    else if (sortMethod === 'kd') {
        sorted.sort((a, b) => {
            const kdA = (a.deaths || 0) > 0 ? (a.kills || 0) / (a.deaths || 0) : (a.kills || 0);
            const kdB = (b.deaths || 0) > 0 ? (b.kills || 0) / (b.deaths || 0) : (b.kills || 0);
            return kdB - kdA;
        });
    } else if (sortMethod === 'flags') {
        sorted.sort((a, b) => {
            const f = (x) => (x.hasDXDCS ? 1 : 0) + (x.hasVAC ? 1 : 0) + (x.hasYooma ? 1 : 0) + (x.hasCS2Red ? 1 : 0) + (x.hasDeti00 ? 1 : 0) + (x.hasPrideCS2 ? 1 : 0) + (x.hasTop2 ? 1 : 0);
            return f(b) - f(a);
        });
    } else if (sortMethod === 'reports') {
        sorted.sort((a, b) => {
            const sidA = String(a.steamId ?? '');
            const sidB = String(b.steamId ?? '');
            return getPlayerReportCount(sidB) - getPlayerReportCount(sidA);
        });
    } else if (sortMethod === 'created') {
        sorted.sort((a, b) => {
            const sidA = String(a.steamId ?? '');
            const sidB = String(b.steamId ?? '');
            const ca = _accAgeCache.get(sidA) || 0;
            const cb = _accAgeCache.get(sidB) || 0;
            return cb - ca; // сверху новые аккаунты
        });
    }
    return { sorted, sortMethod };
}

function buildAllPlayersTable(players) {
    const { sorted, sortMethod } = sortAndFilterAllPlayers(players);
    const activeFilters = getSuspiciousFilters();
    const cf = getCustomFilters();
    const hf = getHideFilters();
    const filtersMeta = getPlayersFiltersUiMeta();

    const sortButtons = [
        ['kills', 'По килам'],
        ['kd', 'По K/D'],
        ['flags', 'По флагам'],
        ['reports', 'По репортам'],
        ['created', 'По дате акка']
    ].map(([m, label]) => {
        const extraAttr = m === 'flags' ? ' data-flags-sort-button="1"' : '';
        return `<button${extraAttr} onclick="changeSuspiciousSort('${m}')" class="px-3 py-1.5 text-xs font-semibold rounded-lg ${sortMethod === m ? 'bg-[#5865F2] text-white' : 'bg-white/[0.05] text-gray-400 hover:bg-white/[0.08]'}">${label}</button>`;
    }).join('');

    const flagsSummary = activeFilters.length === 0
        ? 'Флаги: все источники'
        : `Флаги: выбрано ${activeFilters.length}`;

    const activeFilterCount = countActivePlayersFilters();
    const filterSummary = buildPlayersFilterSummary();
    const countText = sorted.length < players.length ? `<span class="text-gray-500 text-xs ml-auto">${sorted.length} из ${players.length}</span>` : '';
    const savedPresets = getSavedPlayersFilterPresets();
    const savedPresetsHtml = savedPresets.length > 0
        ? `<div class="flex flex-wrap gap-2">${savedPresets.map(preset => `
            <div class="inline-flex items-center gap-1 rounded-lg px-2 py-1 ${filtersMeta.activePresetId === preset.id ? 'bg-emerald-500/15 ring-1 ring-emerald-400/30' : 'bg-white/[0.05]'}">
                <button type="button" onclick="applySavedPlayersFilterPreset('${preset.id}')" class="text-[11px] font-semibold ${filtersMeta.activePresetId === preset.id ? 'text-emerald-200' : 'text-white hover:text-indigo-300'}">${escapeHtml(preset.name)}</button>
                <button type="button" onclick="deleteSavedPlayersFilterPreset('${preset.id}')" class="text-[11px] text-gray-500 hover:text-rose-300">✕</button>
            </div>
        `).join('')}</div>`
        : '<div class="text-[11px] text-gray-500">Сохранённых фильтров пока нет</div>';
    const help = (text) => `<button type="button" class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/[0.06] text-[10px] font-bold text-gray-400 hover:bg-white/[0.12] hover:text-white align-middle" title="${escapeHtml(text)}">?</button>`;

    const filtersMenu = state.filtersMenuOpen ? `
                        <div data-players-filters-menu="1" class="relative z-30 p-4 bg-white/[0.03] rounded-xl border border-white/[0.06] space-y-4">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <div class="text-[10px] uppercase tracking-wide text-gray-500">Фильтры</div>
                    <div class="text-sm font-semibold text-white">Быстрый отбор игроков</div>
                </div>
                <button type="button" onclick="resetPlayersFilters()" class="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold text-gray-300">Сбросить всё</button>
            </div>

            <div class="space-y-2">
                <div class="flex items-center gap-2 text-[11px] font-semibold text-gray-400">Шаблоны ${help('Шаблоны автоматически выставляют готовый набор фильтров. 3 уровень мягче, 1 уровень жёстче и дополнительно включает нулевые профили.')}</div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" onclick="applyPlayersFilterTemplate(3)" class="px-3 py-1.5 rounded-lg text-xs font-semibold ${filtersMeta.activeTemplate === 3 ? 'bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-400/40' : 'bg-white/[0.05] hover:bg-white/[0.1] text-gray-200'}">3 уровень</button>
                    <button type="button" onclick="applyPlayersFilterTemplate(2)" class="px-3 py-1.5 rounded-lg text-xs font-semibold ${filtersMeta.activeTemplate === 2 ? 'bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-400/40' : 'bg-white/[0.05] hover:bg-white/[0.1] text-gray-200'}">2 уровень</button>
                    <button type="button" onclick="applyPlayersFilterTemplate(1)" class="px-3 py-1.5 rounded-lg text-xs font-semibold ${filtersMeta.activeTemplate === 1 ? 'bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-400/40' : 'bg-white/[0.05] hover:bg-white/[0.1] text-gray-200'}">1 уровень</button>
                </div>
            </div>

            <div class="space-y-2">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2 text-[11px] font-semibold text-gray-400">Скрытие ${help('Этот блок скрывает игроков из списка. Если Скрытие выключено, значения сохраняются, но не применяются.')}</div>
                    <button type="button" onclick="toggleHideFiltersEnabled()" class="px-3 py-1.5 rounded-lg text-xs font-semibold ${hf.enabled ? 'bg-rose-500/30 text-rose-200' : 'bg-white/[0.06] text-gray-400 hover:bg-white/[0.1]'}">Скрытие ${hf.enabled ? 'вкл' : 'выкл'}</button>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                        <label class="text-gray-500 text-[11px] flex items-center gap-2 mb-1">Faceit ≥ ${help('Показывать только игроков с таким уровнем Faceit и выше. Если Faceit не найден, игрок скрывается при активном фильтре.')}</label>
                        <input type="number" id="hideMinFaceit" min="0" max="10" value="${hf.minFaceit || ''}" placeholder="—" onchange="applyHideFiltersFromInputs()" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm">
                    </div>
                    <div>
                        <label class="text-gray-500 text-[11px] flex items-center gap-2 mb-1">Faceit ≤ ${help('Показывать только игроков с таким уровнем Faceit и ниже.')}</label>
                        <input type="number" id="hideMaxFaceit" min="0" max="10" value="${hf.maxFaceit || ''}" placeholder="—" onchange="applyHideFiltersFromInputs()" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm">
                    </div>
                    <div>
                        <label class="text-gray-500 text-[11px] flex items-center gap-2 mb-1">Мин. репорты ${help('Оставляет в списке только игроков, у которых репортов не меньше указанного числа.')}</label>
                        <input type="number" id="hideMinReports" min="0" value="${hf.minReports || ''}" placeholder="0" onchange="applyHideFiltersFromInputs()" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm">
                    </div>
                    <div class="flex flex-col gap-2 justify-end">
                        <label class="flex items-center gap-2 text-gray-300 text-[11px]">
                            <input type="checkbox" id="hideNoFlags" ${hf.hideNoFlags ? 'checked' : ''} onchange="applyHideFiltersFromInputs()" class="w-3.5 h-3.5 rounded border-white/20 bg-white/5">
                            Без флагов ${help('Скрывает игроков, у которых нет ни одного флага: DXD, VAC, Yooma, CS2Red, Deti00, Pride, Top2.')}
                        </label>
                    </div>
                </div>
            </div>

            <div class="space-y-2">
                <div class="flex items-center gap-2 text-[11px] font-semibold text-gray-400">Отдельные фильтры ${help('Эти фильтры работают сами по себе и не зависят от переключателя «Скрытие».')}</div>
                <div class="flex flex-wrap gap-4">
                    <label class="flex items-center gap-2 text-gray-300 text-[11px]">
                        <input type="checkbox" id="hideZeroProfiles" ${hf.onlyZeroProfiles ? 'checked' : ''} onchange="applyHideFiltersFromInputs()" class="w-3.5 h-3.5 rounded border-white/20 bg-white/5">
                        Нулевые ${help('Показывает только ненастроенные профили: без нормальной аватарки или с дефолтным пустым профилем. Работает даже когда «Скрытие» выключено.')}
                    </label>
                </div>
            </div>

            <div class="space-y-2">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2 text-[11px] font-semibold text-gray-400">Свои фильтры ${help('Дополнительный ручной отбор по игровым значениям. Срабатывает только когда блок включён.')}</div>
                    <button type="button" onclick="toggleCustomFiltersEnabled()" class="px-3 py-1.5 rounded-lg text-xs font-semibold ${cf.enabled ? 'bg-indigo-500/30 text-indigo-200' : 'bg-white/[0.06] text-gray-400 hover:bg-white/[0.1]'}">Свои фильтры ${cf.enabled ? 'вкл' : 'выкл'}</button>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                        <label class="text-gray-500 text-[11px] flex items-center gap-2 mb-1">Мин. K/D ${help('Оставляет игроков с K/D не ниже указанного значения.')}</label>
                        <input type="number" id="customFilterMinKd" min="0" step="0.01" value="${cf.minKd}" onchange="applyCustomFiltersFromInputs()" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm">
                    </div>
                    <div>
                        <label class="text-gray-500 text-[11px] flex items-center gap-2 mb-1">Мин. килы ${help('Оставляет игроков с количеством килов не ниже указанного порога.')}</label>
                        <input type="number" id="customFilterMinKills" min="0" value="${cf.minKills}" onchange="applyCustomFiltersFromInputs()" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm">
                    </div>
                    <div>
                        <label class="text-gray-500 text-[11px] flex items-center gap-2 mb-1">Мин. смерти ${help('Оставляет игроков, у которых смертей не меньше заданного числа.')}</label>
                        <input type="number" id="customFilterMinDeaths" min="0" value="${cf.minDeaths}" onchange="applyCustomFiltersFromInputs()" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm">
                    </div>
                    <div>
                        <label class="text-gray-500 text-[11px] flex items-center gap-2 mb-1">Макс. смерти ${help('Скрывает игроков, у которых смертей больше указанного числа.')}</label>
                        <input type="number" id="customFilterMaxDeaths" min="0" value="${cf.maxDeaths || ''}" placeholder="—" onchange="applyCustomFiltersFromInputs()" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-sm">
                    </div>
                </div>
            </div>

            <div class="space-y-2">
                <div class="flex items-center gap-2 text-[11px] font-semibold text-gray-400">Сохранить набор ${help('Сохраняет текущую комбинацию фильтров, чтобы потом быстро включать её одной кнопкой.')}</div>
                <div class="flex flex-wrap gap-2">
                    <input type="text" id="playersFilterPresetName" maxlength="32" placeholder="Название набора" onkeydown="if(event.key==='Enter'){saveCurrentPlayersFiltersPreset()}" class="flex-1 min-w-[180px] bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm">
                    <button type="button" onclick="saveCurrentPlayersFiltersPreset()" class="px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold">Сохранить</button>
                </div>
                ${savedPresetsHtml}
            </div>
        </div>` : '';

    return `
        <div class="px-1 -mt-3 space-y-1.5 mb-2">
            <div class="flex items-center gap-2 text-[11px] text-gray-500">
                <span>${flagsSummary}</span>
                ${countText}
            </div>
            <div class="flex gap-2 items-center justify-between w-full">
                <div class="flex gap-2">${sortButtons}</div>
                <div class="flex gap-2 items-center">
                    <div class="relative" data-columns-dropdown="1">
                        <button type="button" onclick="togglePlayersColumnsMenu(event)" class="px-3 py-2 text-xs font-semibold rounded-lg bg-white/[0.08] text-gray-300 hover:bg-white/[0.12] flex items-center gap-1.5">
                            Исключения <i class="ph ph-caret-down text-[10px]"></i>
                        </button>
                        <div id="playersColumnsMenu" class="${state.columnsMenuOpen ? '' : 'hidden'} ui-select-menu players-columns-menu absolute right-0 top-full mt-1 rounded-xl shadow-xl z-50">
                            <div class="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2 pt-1 pb-1">Колонки</div>
                            ${PLAYERS_COLUMNS_DEF.map(c => {
                                const v = getPlayersTableColumns();
                                const checked = v[c.id] !== false;
                                return `<label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/[0.08] cursor-pointer text-xs text-gray-100"><input type="checkbox" ${checked ? 'checked' : ''} onchange="togglePlayersColumn('${c.id}')" class="w-3.5 h-3.5 rounded border-white/20 bg-white/5">${c.label}</label>`;
                            }).join('')}
                            <div class="my-1 border-t border-white/10"></div>
                            <div class="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2 pt-1 pb-1">Исключать</div>
                            ${(() => {
                                const ex = getPlayersExclusions();
                                const checked = ex.excludeCsgoServers ? 'checked' : '';
                                return `<label class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/[0.08] cursor-pointer text-xs text-gray-100" title="Скрывает игроков, которые сейчас находятся на CS:GO серверах."><input type="checkbox" ${checked} onchange="togglePlayersExclusion('excludeCsgoServers')" class="w-3.5 h-3.5 rounded border-white/20 bg-white/5"><span class="inline-flex items-center gap-1">${serverGameIconHtml('CSGO')}<span>CS:GO сервера</span></span></label>`;
                            })()}
                        </div>
                    </div>
                    <button type="button" data-players-filters-toggle="1" onclick="togglePlayersFiltersMenu()" class="px-3 py-2 text-xs font-semibold rounded-lg ${state.filtersMenuOpen ? 'bg-indigo-500/30 text-indigo-200' : 'bg-white/[0.08] text-gray-300 hover:bg-white/[0.12]'}">
                        Фильтры${activeFilterCount > 0 ? ` • ${activeFilterCount}` : ''}
                    </button>
                </div>
            </div>
            ${filterSummary ? `<div class="flex flex-wrap gap-2">${filterSummary}</div>` : ''}
            ${filtersMenu}
        </div>
        <div class="overflow-x-auto hide-scrollbar">
            <table class="w-full" data-table="suspicious">
                <thead class="bg-white/[0.03] sticky top-0 z-10">
                    <tr>
                        ${(() => { const v = getPlayersTableColumns(); return PLAYERS_COLUMNS_DEF.filter(c => v[c.id]).map(c => `<th data-column="${c.id}" class="py-2.5 px-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">${c.label}</th>`).join(''); })()}
                    </tr>
                </thead>
                <tbody>
                ${sorted.map((p, i) => buildSuspiciousRowHtml(p, i)).join('')}
                </tbody></table>
        </div>`;
}

const _accAgeCache = new Map();
let _accAgeBatchQueue = [];
let _accAgeBatchTimer = null;

function requestAccountAgeFor(players, idKey) {
    players.forEach(p => {
        const sid = p[idKey] != null ? String(p[idKey]) : '';
        if (!sid) return;
        const cached = _accAgeCache.get(sid);
        if (cached !== undefined) {
            applyAccountAge({ steamId: sid, created: cached }, { scheduleRefresh: false });
            return;
        }
        if (!_accAgeBatchQueue.includes(sid)) {
            _accAgeBatchQueue.push(sid);
        }
    });
    if (_accAgeBatchQueue.length > 0 && !_accAgeBatchTimer) {
        _accAgeBatchTimer = setTimeout(flushAccAgeBatch, 50);
    }
}

function flushAccAgeBatch() {
    _accAgeBatchTimer = null;
    const ids = _accAgeBatchQueue.splice(0);
    if (ids.length === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'get_account_age_batch', steamIds: ids }));
}

function deti00Reason(raw) {
    if (!raw) return 'D00';
    const r = raw.trim();
    if (/\[!VOTE\]/i.test(r)) return 'Голосование';
    const map = {
        '1.1': 'Правила', '1.2': 'Правила', '1.3': 'Правила', '1.4': 'Правила',
        '1.5': 'Правила', '1.6': 'Правила', '1.7': 'Правила', '1.8': 'Донат',
        '1.9': 'Донат', '1.10': 'Правила', '1.11': 'Правила', '1.12': 'Правила',
        '1.13': 'Правила', '1.14': 'Правила',
        '2.1': 'Аккаунт', '2.2': 'Аккаунт', '2.3': 'Аккаунт', '2.4': 'Имущество',
        '2.5': 'Имущество', '2.6': 'Привилегия', '2.7': 'Передача', '2.8': 'Взлом',
        '2.9': 'RMT', '2.10': 'RMT', '2.11': 'RMT', '2.12': 'Обход',
        '2.13': 'Вымогательство', '2.14': 'Мульти-акк',
        '3.1': 'Оскорбления', '3.2': 'Оскорбления', '3.3': 'Реклама', '3.4': 'Спам',
        '3.5': 'Провокация', '3.6': 'Угрозы', '3.7': 'Дезинформация',
        '4.1': 'Читы', '4.2': 'Читы', '4.3': 'Макросы', '4.4': 'Баги',
        '4.5': 'Гриф', '4.6': 'АФК', '4.7': 'Кемп',
        '5.1': 'Читы', '5.2': 'Читы', '5.3': 'Макросы', '5.4': 'Баги',
        '5.5': 'Гриф', '5.6': 'АФК', '5.7': 'Кемп', '5.8': 'ТК',
        '5.9': 'Отказ', '5.10': 'Читы', '5.11': 'Читы',
        '6.1': 'Правила', '6.2': 'Правила', '6.3': 'Правила',
        '7.1': 'Правила', '7.2': 'Правила', '7.3': 'Правила',
        '8.1': 'Отказ', '8.2': 'Выход', '8.3': 'Затяжка', '8.4': 'Затяжка'
    };
    const m = r.match(/(\d+\.\d+)/);
    if (m) {
        if (map[m[1]]) return map[m[1]];
    }
    if (/чит/i.test(r)) return 'Читы';
    if (/обход/i.test(r)) return 'Обход';
    if (/отказ/i.test(r)) return 'Отказ';
    if (/оскорб/i.test(r)) return 'Оскорбления';
    if (/реклам/i.test(r)) return 'Реклама';
    if (/макрос/i.test(r)) return 'Макросы';
    if (/баг/i.test(r)) return 'Баги';
    if (/гриф/i.test(r)) return 'Гриф';
    if (/афк|afk/i.test(r)) return 'АФК';
    if (/спам/i.test(r)) return 'Спам';
    if (/RMT/i.test(r)) return 'RMT';
    if (/взлом/i.test(r)) return 'Взлом';
    if (/мульти/i.test(r)) return 'Мульти-акк';
    return r.length > 10 ? r.substring(0, 10) + '…' : r;
}

function cs2redReason(raw) {
    if (!raw) return 'CS2Red';
    const r = raw.trim();
    if (/RAC/i.test(r) || r.includes('[i:')) return 'AC';
    const map = {
        'П.П. 1.1': 'Читы', 'П.П 1.1': 'Читы', '1.1': 'Читы',
        'П.П. 1.2': 'Затяжка', 'П.П 1.2': 'Затяжка', '1.2': 'Затяжка',
        'П.П. 1.3': 'Багоюз', 'П.П 1.3': 'Багоюз', '1.3': 'Багоюз',
        'П.П. 1.4': 'Ложный кик', 'П.П 1.4': 'Ложный кик', '1.4': 'Ложный кик',
        'П.П. 1.5': 'Гриф', 'П.П 1.5': 'Гриф', '1.5': 'Гриф',
        'П.П. 1.6': 'Мульти-акк', 'П.П 1.6': 'Мульти-акк', '1.6': 'Мульти-акк',
        'П.П. 1.7': 'Багоюз валюты', 'П.П 1.7': 'Багоюз валюты', '1.7': 'Багоюз валюты',
        'П.П. 1.8': 'Скам', 'П.П 1.8': 'Скам', '1.8': 'Скам',
        'П.П. 1.9': 'Прочее', 'П.П 1.9': 'Прочее', '1.9': 'Прочее',
        'П.П. 1.10': 'RMT', 'П.П 1.10': 'RMT', '1.10': 'RMT',
        'П.П. 2.1': 'RMT реклама', 'П.П 2.1': 'RMT реклама', '2.1': 'RMT реклама',
        'П.П. 2.2': 'Оскорбления', 'П.П 2.2': 'Оскорбления', '2.2': 'Оскорбления',
        'П.П. 2.3': 'Реклама', 'П.П 2.3': 'Реклама', '2.3': 'Реклама',
        'П.П. 2.4': 'Палево', 'П.П 2.4': 'Палево', '2.4': 'Палево',
        'П.П. 2.5': 'Палево админа', 'П.П 2.5': 'Палево админа', '2.5': 'Палево админа',
        'П.П. 2.6': 'Дезинформация', 'П.П 2.6': 'Дезинформация', '2.6': 'Дезинформация'
    };
    if (map[r]) return map[r];
    const m = r.match(/(\d+\.\d+)/);
    if (m && map[m[1]]) return map[m[1]];
    return r.length > 12 ? r.substring(0, 12) + '…' : r;
}

function formatAccountAge(ts) {
    if (!ts || ts <= 0) return '—';
    const d = new Date(ts * 1000);
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatBanReceivedDate(value) {
    if (value == null || value === '') return '';

    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const ms = value > 1e12 ? value : value * 1000;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru');
    }

    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{2}\.\d{2}\.\d{4}/.test(raw)) return raw;
    if (/^\d{10,13}$/.test(raw)) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) {
            const ms = raw.length >= 13 ? n : n * 1000;
            const d = new Date(ms);
            return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru');
        }
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('ru');
}

function applyAccountAge(data, options = {}) {
    const sid = data.steamId != null ? String(data.steamId) : '';
    if (!sid) return;
    const created = data.created || 0;
    _accAgeCache.set(sid, created);
    const el = document.getElementById(`acc-age-${sid}`);
    if (el) {
        const nextText = created > 0 ? formatAccountAge(created) : 'Скрыт';
        const nextClass = created > 0 ? 'text-blue-400 mt-0.5' : 'text-gray-600 mt-0.5';
        if (el.textContent !== nextText) el.textContent = nextText;
        if (el.className !== nextClass) el.className = nextClass;
    }
    if (options.scheduleRefresh && isPlayersCategoryOpen() && isCreatedSortActive()) {
        schedulePlayersPanelRefresh(false, 120);
    }
}

function applyPlayerGames(data) {
    const el = document.getElementById(`games-${data.steamId}`);
    if (!el) return;
    if (data.error) {
        el.innerHTML = '<span class="text-rose-400">Ошибка загрузки</span>';
        return;
    }
    if (data.games && data.games.length > 0) {
        el.innerHTML = `<span class="text-amber-400">${data.games.map(g => g.name).join(', ')}</span>`;
    } else {
        el.innerHTML = '<span class="text-gray-500">Нет игр с банами</span>';
    }
}

function getFaceitLevelColor(level) {
    if (level >= 10) return '#ff5500';
    if (level >= 8) return '#ff8c00';
    if (level >= 6) return '#ffcc00';
    if (level >= 4) return '#66bb6a';
    if (level >= 2) return '#90caf9';
    return '#9e9e9e';
}

function faceitLevelBadgeHtml(sid) {
    const fl = state.faceitLevels[sid];
    if (!fl || !fl.level) return '';
    const color = getFaceitLevelColor(fl.level);
    const url = fl.url || `https://www.faceit.com/en/players-modal/${sid}`;
    return `<a href="${url}" target="_blank" id="faceit-${sid}" class="inline-flex items-center hover:opacity-80 transition-opacity" title="Faceit Lvl ${fl.level} (${fl.elo} ELO)"><img src="/images/lvl${fl.level}.svg" class="w-4.5 h-4.5"></a>`;
}

function applyFaceitLevels() {
    for (const [sid, fl] of Object.entries(state.faceitLevels)) {
        const el = document.getElementById(`faceit-${sid}`);
        if (el) {
            const color = getFaceitLevelColor(fl.level);
            el.style.background = `${color}20`;
            el.style.color = color;
            el.innerHTML = `<img src="/images/lvl${fl.level}.svg" class="w-4.5 h-4.5">`;
            el.title = `Faceit Lvl ${fl.level} (${fl.elo} ELO)`;
        }
    }
}

function copyLauncherDocText(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const t = String(el.textContent || '').trim();
    if (!t) return;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard.writeText(t);
    }
}

// ——— Панель: открыть/закрыть ———

function openSidePanel(category) {
    if (category === 'Лаунчер' && getUserLevel() < 5) {
        return;
    }
    const panel = document.getElementById('sidePanel');
    if (!panel) return;
    if (state.openCategory === category && panel.classList.contains('show')) {
        closeSidePanel();
        return;
    }
    const switching = state.openCategory && state.openCategory !== category && panel.classList.contains('show');
    state.openCategory = category;
    if (category === 'Изменения' && !state.changesTab) {
        state.changesTab = 'roles';
    }
    if (category === 'Лаунчер') {
        void apiFetch('/api/me')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data && typeof data.launcherApiKey === 'string' && data.launcherApiKey) {
                    state.launcherApiKey = data.launcherApiKey;
                }
                if (state.openCategory === 'Лаунчер') scheduleRenderPanel();
            })
            .catch(() => {});
    }
    if (category === 'Наказания') loadPunishmentsStaffList();
    if (category === 'Наказания') prefetchPunishmentsSummary();
    if (category === 'Игроки' || category === 'Опасные') startFearReportsIfNeeded();
    document.querySelectorAll('.dropdown-item[data-category]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-category') === category);
    });

    const content = document.getElementById('panelContent');
    if (switching && content) {
        content.style.transition = 'opacity 0.15s ease';
        content.style.opacity = '0';
        setTimeout(() => {
            scheduleRenderPanel();
            staggerRows(content);
            requestAnimationFrame(() => {
                content.style.opacity = '1';
            });
        }, 150);
    } else {
        panel.classList.add('show');
        scheduleRenderPanel();
        if (content) staggerRows(content);
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        const level = getUserLevel();
        if (category === 'VAC') ws.send(JSON.stringify({ type: 'get_vac_bans' }));
        else if (category === 'Yooma') ws.send(JSON.stringify({ type: 'get_yooma_bans', userLevel: level }));
        else if (category === 'Игроки' || category === 'Опасные') {
            ws.send(JSON.stringify({ type: 'get_suspicious_bans', userLevel: level }));
            ws.send(JSON.stringify({ type: 'get_all_players' }));
        }
    }
}

function staggerRows(container) {
    const rows = container.querySelectorAll('tr');
    if (document.body.classList.contains('local-no-anim') || rows.length > 40) {
        rows.forEach(row => {
            row.classList.remove('row-new');
            row.style.animationDelay = '';
        });
        return;
    }
    rows.forEach((row, i) => {
        row.classList.add('row-new');
        row.style.animationDelay = `${i * 30}ms`;
    });
}

function closeSidePanel() {
    const panel = document.getElementById('sidePanel');
    if (panel) {
        panel.classList.remove('show');
    }
    state.openCategory = null;
    state.customFiltersOpen = false;
    state.filtersMenuOpen = false;
    state.columnsMenuOpen = false;
    document.querySelectorAll('.dropdown-item[data-category]').forEach(el => el.classList.remove('active'));
}

// ——— Свои фильтры (min K/D, min kills) ———
function getDefaultCustomFilters() {
    return { minKd: 0, minKills: 0, minDeaths: 0, maxDeaths: 0, enabled: false };
}

function getDefaultHideFilters() {
    return { minFaceit: 0, maxFaceit: 0, minReports: 0, hideNoFlags: false, onlyZeroProfiles: false, enabled: false };
}

function getPlayersFiltersUiMeta() {
    try {
        const raw = localStorage.getItem('playersFiltersUiMeta');
        const parsed = JSON.parse(raw || '{}');
        return {
            activeTemplate: Number(parsed.activeTemplate) || null,
            activePresetId: parsed.activePresetId || null
        };
    } catch (_) {
        return { activeTemplate: null, activePresetId: null };
    }
}

function setPlayersFiltersUiMeta(next) {
    const prev = getPlayersFiltersUiMeta();
    localStorage.setItem('playersFiltersUiMeta', JSON.stringify({ ...prev, ...next }));
}

function clearPlayersFiltersUiMeta() {
    setPlayersFiltersUiMeta({ activeTemplate: null, activePresetId: null });
}

function togglePlayersFiltersMenu() {
    state.filtersMenuOpen = !state.filtersMenuOpen;
    if (state.filtersMenuOpen) state.columnsMenuOpen = false;
    scheduleRenderPanel();
}

function togglePlayersColumnsMenu(e) {
    e?.stopPropagation?.();
    state.columnsMenuOpen = !state.columnsMenuOpen;
    scheduleRenderPanel();
}

function countActivePlayersFilters() {
    const cf = getCustomFilters();
    const hf = getHideFilters();
    let count = 0;
    if (getSuspiciousFilters().length > 0) count += 1;
    if (cf.enabled) {
        if (cf.minKd > 0) count += 1;
        if (cf.minKills > 0) count += 1;
        if (cf.minDeaths > 0) count += 1;
        if (cf.maxDeaths > 0) count += 1;
    }
    if (hf.enabled) {
        if (hf.minFaceit > 0) count += 1;
        if (hf.maxFaceit > 0) count += 1;
        if (hf.minReports > 0) count += 1;
        if (hf.hideNoFlags) count += 1;
    }
    if (hf.onlyZeroProfiles) count += 1;
    return count;
}

function buildPlayersFilterSummary() {
    const chips = [];
    const cf = getCustomFilters();
    const hf = getHideFilters();
    const flags = getSuspiciousFilters();
    if (flags.length > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-white/[0.06] text-[11px] text-gray-300">Флаги: ${flags.length}</span>`);
    if (hf.enabled && hf.minFaceit > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-rose-500/15 text-[11px] text-rose-200">Faceit ≥ ${hf.minFaceit}</span>`);
    if (hf.enabled && hf.maxFaceit > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-rose-500/15 text-[11px] text-rose-200">Faceit ≤ ${hf.maxFaceit}</span>`);
    if (hf.enabled && hf.minReports > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-rose-500/15 text-[11px] text-rose-200">Репорты ≥ ${hf.minReports}</span>`);
    if (hf.enabled && hf.hideNoFlags) chips.push(`<span class="px-2 py-1 rounded-lg bg-rose-500/15 text-[11px] text-rose-200">Без флагов скрыты</span>`);
    if (hf.onlyZeroProfiles) chips.push(`<span class="px-2 py-1 rounded-lg bg-amber-500/15 text-[11px] text-amber-200">Нулевые</span>`);
    if (cf.enabled && cf.minKd > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-indigo-500/15 text-[11px] text-indigo-200">K/D ≥ ${cf.minKd}</span>`);
    if (cf.enabled && cf.minKills > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-indigo-500/15 text-[11px] text-indigo-200">Килы ≥ ${cf.minKills}</span>`);
    if (cf.enabled && cf.minDeaths > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-indigo-500/15 text-[11px] text-indigo-200">Смерти ≥ ${cf.minDeaths}</span>`);
    if (cf.enabled && cf.maxDeaths > 0) chips.push(`<span class="px-2 py-1 rounded-lg bg-indigo-500/15 text-[11px] text-indigo-200">Смерти ≤ ${cf.maxDeaths}</span>`);
    return chips.join('');
}

function getSavedPlayersFilterPresets() {
    try {
        const raw = localStorage.getItem('savedPlayersFilterPresets');
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function setSavedPlayersFilterPresets(list) {
    localStorage.setItem('savedPlayersFilterPresets', JSON.stringify(list));
}

const PLAYERS_FILTER_TEMPLATES = {
    3: {
        name: '3 уровень',
        hide: {
            enabled: true,
            maxFaceit: 3,
            minReports: 1,
            hideNoFlags: true,
            onlyZeroProfiles: false
        },
        custom: {
            enabled: false,
            minKd: 0,
            minKills: 0,
            minDeaths: 0,
            maxDeaths: 0
        },
        flags: []
    },
    2: {
        name: '2 уровень',
        hide: {
            enabled: true,
            maxFaceit: 2,
            minReports: 2,
            hideNoFlags: true,
            onlyZeroProfiles: false
        },
        custom: {
            enabled: true,
            minKd: 1,
            minKills: 4,
            minDeaths: 0,
            maxDeaths: 0
        },
        flags: []
    },
    1: {
        name: '1 уровень',
        hide: {
            enabled: true,
            maxFaceit: 1,
            minReports: 3,
            hideNoFlags: true,
            onlyZeroProfiles: true
        },
        custom: {
            enabled: true,
            minKd: 1.2,
            minKills: 6,
            minDeaths: 0,
            maxDeaths: 0
        },
        flags: []
    }
};

function saveCurrentPlayersFiltersPreset() {
    const input = document.getElementById('playersFilterPresetName');
    const name = String(input?.value || '').trim().slice(0, 32);
    if (!name) {
        if (input) input.focus();
        return;
    }
    const list = getSavedPlayersFilterPresets().filter(item => item.name !== name);
    const preset = {
        id: `preset_${Date.now()}`,
        name,
        custom: getCustomFilters(),
        hide: getHideFilters(),
        flags: getSuspiciousFilters()
    };
    setSavedPlayersFilterPresets([preset, ...list].slice(0, 12));
    setPlayersFiltersUiMeta({ activeTemplate: null, activePresetId: preset.id });
    if (input) input.value = '';
    scheduleRenderPanel();
}

function applySavedPlayersFilterPreset(id) {
    const preset = getSavedPlayersFilterPresets().find(item => item.id === id);
    if (!preset) return;
    setCustomFilters({ ...getDefaultCustomFilters(), ...(preset.custom || {}) });
    setHideFilters({ ...getDefaultHideFilters(), ...(preset.hide || {}) });
    setSuspiciousFilters(Array.isArray(preset.flags) ? preset.flags : []);
    setPlayersFiltersUiMeta({ activeTemplate: null, activePresetId: id });
    schedulePlayersPanelRefresh(false, 0);
}

function deleteSavedPlayersFilterPreset(id) {
    const next = getSavedPlayersFilterPresets().filter(item => item.id !== id);
    setSavedPlayersFilterPresets(next);
    const meta = getPlayersFiltersUiMeta();
    if (meta.activePresetId === id) {
        setPlayersFiltersUiMeta({ activePresetId: null });
    }
    scheduleRenderPanel();
}

function applyPlayersFilterTemplate(level) {
    const template = PLAYERS_FILTER_TEMPLATES[level];
    if (!template) return;
    setCustomFilters({
        ...getDefaultCustomFilters(),
        ...(template.custom || {})
    });
    setHideFilters({
        ...getDefaultHideFilters(),
        ...(template.hide || {})
    });
    setSuspiciousFilters(Array.isArray(template.flags) ? template.flags : []);
    setPlayersFiltersUiMeta({ activeTemplate: level, activePresetId: null });
    schedulePlayersPanelRefresh(false, 0);
    scheduleRenderPanel();
}

function resetPlayersFilters() {
    setCustomFilters(getDefaultCustomFilters());
    setHideFilters(getDefaultHideFilters());
    setSuspiciousFilters([]);
    clearPlayersFiltersUiMeta();
    schedulePlayersPanelRefresh(false, 0);
    scheduleRenderPanel();
}

function getCustomFilters() {
    try {
        const stored = localStorage.getItem('customPlayerFilters');
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                minKd: parseFloat(parsed.minKd) || 0,
                minKills: parseInt(parsed.minKills, 10) || 0,
                minDeaths: parseInt(parsed.minDeaths, 10) || 0,
                maxDeaths: parseInt(parsed.maxDeaths, 10) || 0,
                enabled: parsed.enabled !== false // по умолчанию вкл для обратной совместимости
            };
        }
    } catch (_) {}
    return getDefaultCustomFilters();
}

function setCustomFilters(obj) {
    const prev = getCustomFilters();
    localStorage.setItem('customPlayerFilters', JSON.stringify({ ...prev, ...obj }));
}

function applyCustomFilters(players) {
    const f = getCustomFilters();
    if (!f.enabled) return players;
    if (f.minKd <= 0 && f.minKills <= 0 && f.minDeaths <= 0 && f.maxDeaths <= 0) return players;
    return players.filter(p => {
        const k = p.kills || 0, d = p.deaths || 0;
        const kd = d > 0 ? k / d : k;
        if (f.minKd > 0 && kd < f.minKd) return false;
        if (f.minKills > 0 && k < f.minKills) return false;
        if (f.minDeaths > 0 && d < f.minDeaths) return false;
        if (f.maxDeaths > 0 && d > f.maxDeaths) return false;
        return true;
    });
}

// ——— Скрытие игроков (Faceit/репорты/флаги) ———
function getHideFilters() {
    try {
        const stored = localStorage.getItem('hidePlayerFilters');
        if (stored) {
        const parsed = JSON.parse(stored);
        return {
            minFaceit: parseInt(parsed.minFaceit, 10) || 0,
            maxFaceit: parseInt(parsed.maxFaceit, 10) || 0,
            minReports: parseInt(parsed.minReports, 10) || 0,
            hideNoFlags: Boolean(parsed.hideNoFlags),
            onlyZeroProfiles: Boolean(parsed.onlyZeroProfiles),
            enabled: parsed.enabled === true
        };
        }
    } catch (_) {}
    return getDefaultHideFilters();
}

function setHideFilters(obj) {
    const prev = getHideFilters();
    localStorage.setItem('hidePlayerFilters', JSON.stringify({ ...prev, ...obj }));
}

function isZeroProfile(player) {
    const avatar = String(player?.avatar || '').trim();
    if (!avatar) return true;
    if (avatar === DEFAULT_AVATAR) return true;
    return avatar.includes('fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb');
}

function applyHideFilters(players) {
    const f = getHideFilters();
    const hideBlockActive = Boolean(f.enabled && (f.minFaceit || f.maxFaceit || f.minReports || f.hideNoFlags));
    const zeroProfilesActive = Boolean(f.onlyZeroProfiles);
    if (!hideBlockActive && !zeroProfilesActive) return players;
    return players.filter(p => {
        const sid = String(p.steamId ?? '');
        const faceit = (state.faceitLevels && state.faceitLevels[sid]?.level) || p.faceitLevel || 0;
        const reports = getPlayerReportCount(sid);
        if (hideBlockActive && f.minFaceit > 0) {
            if (!faceit || faceit < f.minFaceit) return false;
        }
        if (hideBlockActive && f.maxFaceit > 0) {
            if (faceit && faceit > f.maxFaceit) return false;
        }
        if (hideBlockActive && f.minReports && reports < f.minReports) return false;
        if (hideBlockActive && f.hideNoFlags) {
            const hasAnyFlag = p.hasDXDCS || p.hasVAC || p.hasYooma || p.hasCS2Red || p.hasDeti00 || p.hasPrideCS2 || p.hasTop2;
            if (!hasAnyFlag) return false;
        }
        if (zeroProfilesActive && !isZeroProfile(p)) return false;
        return true;
    });
}

function toggleHideFiltersEnabled() {
    const hf = getHideFilters();
    setHideFilters({ enabled: !hf.enabled });
    clearPlayersFiltersUiMeta();
    schedulePlayersPanelRefresh(false, 0);
    scheduleRenderPanel();
}

function applyHideFiltersFromInputs() {
    const minFaceit = parseInt(document.getElementById('hideMinFaceit')?.value, 10) || 0;
    const maxFaceit = parseInt(document.getElementById('hideMaxFaceit')?.value, 10) || 0;
    const minReports = parseInt(document.getElementById('hideMinReports')?.value, 10) || 0;
    const hideNoFlags = Boolean(document.getElementById('hideNoFlags')?.checked);
    const onlyZeroProfiles = Boolean(document.getElementById('hideZeroProfiles')?.checked);
    setHideFilters({ minFaceit, maxFaceit, minReports, hideNoFlags, onlyZeroProfiles });
    clearPlayersFiltersUiMeta();
    schedulePlayersPanelRefresh(false, 0);
    scheduleRenderPanel();
}

function toggleCustomFiltersEnabled() {
    const cf = getCustomFilters();
    setCustomFilters({ enabled: !cf.enabled });
    clearPlayersFiltersUiMeta();
    schedulePlayersPanelRefresh(false, 0);
    scheduleRenderPanel();
}

function applyCustomFiltersFromInputs() {
    const minKd = parseFloat(document.getElementById('customFilterMinKd')?.value) || 0;
    const minKills = parseInt(document.getElementById('customFilterMinKills')?.value, 10) || 0;
    const minDeaths = parseInt(document.getElementById('customFilterMinDeaths')?.value, 10) || 0;
    const maxDeaths = parseInt(document.getElementById('customFilterMaxDeaths')?.value, 10) || 0;
    setCustomFilters({ minKd, minKills, minDeaths, maxDeaths });
    clearPlayersFiltersUiMeta();
    schedulePlayersPanelRefresh(false, 0);
    scheduleRenderPanel();
}

function mergeAllPlayersWithBans(players) {
    const suspiciousMap = new Map();
    (state.suspicious.players || []).forEach(p => suspiciousMap.set(String(p.steamId), p));
    return players.map(p => {
        const sid = String(p.steamId ?? '');
        const sp = suspiciousMap.get(sid);
        if (!sp) return { ...p, steamId: sid };
        return { ...p, ...sp, steamId: sid };
    });
}

function toggleSuspiciousFilter(key) {
    const filters = getSuspiciousFilters();
    const idx = filters.indexOf(key);
    if (idx >= 0) filters.splice(idx, 1); else filters.push(key);
    setSuspiciousFilters(filters);
    clearPlayersFiltersUiMeta();
    refreshAllPlayersPanel(false);
}

function changeSuspiciousSort(method) {
    localStorage.setItem('suspiciousSortMethod', method);
    refreshAllPlayersPanel(false);
}

function refreshAllPlayersPanel(withAnimation = true) {
    const content = document.getElementById('panelContent');
    if (!content || !isPlayersCategoryOpen()) return;
    const { players } = state.allPlayers;
    const merged = mergeAllPlayersWithBans(players || []);
    content.innerHTML = buildAllPlayersTable(merged);
    if (withAnimation) staggerRows(content);
    requestAccountAgeFor(merged, 'steamId');
}

// ——— Проверка игрока ———

function processCheckData(checkData, steamId, forModal = false) {
    const p = checkData.local || {};
    const f = checkData.fear || null;
    const y = checkData.yooma || null;
    const s = checkData.steam || null;
    const cr = checkData.cs2red || null;
    const d00 = checkData.deti00 || null;
    const pride = checkData.pride || null;
    const top2 = checkData.top2 || null;
    const fc = checkData.faceit || null;
    const nick = s?.personaName || f?.name || p.nickname || 'Unknown';
    const avatar = s?.avatarFull || f?.avatar_medium || f?.avatar || p.avatar || DEFAULT_AVATAR;

    const bans = (p.bans || []).map(b => ({ ...b, receivedAt: b.receivedAt || b.date || b.created || b.timestamp || '' }));
    if (y?.banned && !bans.find(b => b.source === 'Yooma')) {
        const reason = (y.reason || '').trim();
        let reasonShort = reason;
        if (reason.includes('Haron Anti-Cheat')) reasonShort = 'AC';
        else if (/отказ/i.test(reason)) reasonShort = 'Отказ';
        else if (/обход/i.test(reason)) reasonShort = 'Обход';
        else if (/использован.*чит|читерств|чит/i.test(reason)) reasonShort = 'Читы';
        const extra = y.isPermanent ? 'перм' : (y.expires ? `до ${new Date(y.expires * 1000).toLocaleDateString('ru')}` : '');
        bans.push({ source: 'Yooma', reason: reasonShort, extra, receivedAt: y.created });
    }
    if (f?.banInfo?.isBanned) {
        const unban = f.banInfo.unbanTimestamp ? new Date(f.banInfo.unbanTimestamp * 1000) : null;
        const unbanText = unban ? `до ${unban.toLocaleDateString('ru')}` : 'перм';
        bans.push({ source: 'FEAR', reason: f.banInfo.reason || '—', extra: unbanText, receivedAt: f.banInfo.created || f.banInfo.createdAt || f.banInfo.createdTimestamp || '' });
    }
    if (s?.communityBanned) bans.push({ source: 'Steam', reason: 'Community Ban' });
    if (s?.economyBan && s.economyBan !== 'none') bans.push({ source: 'Steam', reason: `Economy: ${s.economyBan}` });
    const has = src => bans.some(b => b.source === src);
    if (cr?.found && cr.banned && cr.bans?.length > 0 && !has('CS2Red')) {
        for (const b of cr.bans) {
            const extra = b.isPermanent ? 'перм' : (b.endTimestamp ? `до ${new Date(b.endTimestamp * 1000).toLocaleDateString('ru')}` : '');
            bans.push({ source: 'CS2Red', reason: cs2redReason(b.reason), extra, receivedAt: b.timestamp });
        }
    }
    if (!has('Deti00')) {
        if (d00?.banned && d00.bans?.length > 0) {
            for (const b of d00.bans) bans.push({ source: 'Deti00', reason: deti00Reason(b.reason), extra: b.expires ? `до ${b.expires}` : b.duration || '', receivedAt: b.date || d00.date || '' });
        } else if (d00?.banned) {
            bans.push({ source: 'Deti00', reason: deti00Reason(d00.reason), extra: d00.expires ? `до ${d00.expires}` : '', receivedAt: d00.date || '' });
        }
    }
    if (!has('PrideCS2')) {
        if (pride?.banned && pride.bans?.length > 0) {
            for (const b of pride.bans) bans.push({ source: 'PrideCS2', reason: b.reason || 'PrideCS2', extra: b.expires ? `до ${b.expires}` : b.duration || '', receivedAt: b.date || pride.date || '' });
        } else if (pride?.banned) {
            bans.push({ source: 'PrideCS2', reason: pride.reason || 'PrideCS2', extra: pride.expires ? `до ${pride.expires}` : '', receivedAt: pride.date || '' });
        }
    }
    if (!has('Top2')) {
        if (top2?.banned && top2.bans?.length > 0) {
            for (const b of top2.bans) {
                let r = (b.reason || 'Top2').trim();
                if (/отказ/i.test(r)) r = 'Отказ';
                else if (/использован.*чит|чит/i.test(r)) r = 'Читы';
                else if (/обход/i.test(r)) r = 'Обход';
                else if (/читерств/i.test(r)) r = 'Читы';
                bans.push({ source: 'Top2', reason: r, extra: b.expires ? `до ${b.expires}` : b.duration || '', receivedAt: b.date || top2.date || '' });
            }
        } else if (top2?.banned) {
            bans.push({ source: 'Top2', reason: top2.reason || 'Top2', extra: top2.expires ? `до ${top2.expires}` : '', receivedAt: top2.date || '' });
        }
    }

    const banClasses = { VAC: ['bg-rose-500/10', 'text-rose-400'], Yooma: ['bg-indigo-500/10', 'text-indigo-400'], DXD: ['bg-red-500/10', 'text-red-400'], FEAR: ['bg-orange-500/10', 'text-orange-400'], Steam: ['bg-red-500/10', 'text-red-400'], CS2Red: ['bg-cyan-500/10', 'text-cyan-400'], Deti00: ['bg-teal-500/10', 'text-teal-400'], PrideCS2: ['bg-orange-500/10', 'text-orange-400'], Top2: ['bg-lime-500/10', 'text-lime-400'] };
    const bansHtml = bans.length > 0 ? bans.map(b => {
        const [bgClass, textClass] = banClasses[b.source] || ['bg-gray-500/10', 'text-gray-400'];
        const icons = { VAC: '/images/valve.ico', Yooma: '/images/yooma-logo.png', DXD: '/images/dxdcs2.ico', FEAR: '/images/Fear.ico', Steam: '/images/valve.ico', CS2Red: '/images/cs2red.ico', Deti00: '/images/deti00.ico', PrideCS2: '/images/pridecs2.ico', Top2: '/images/top2.ico' };
        const ico = icons[b.source] ? `<img src="${icons[b.source]}" class="w-4 h-4">` : '';
        let detail = b.reason || '—';
        if (b.source === 'VAC') detail = `Game банов: ${b.gameBans}, ${b.daysSince} дн. назад`;
        else if (['DXD','Deti00','PrideCS2','Top2','Yooma','CS2Red'].includes(b.source)) {
            let r = (b.reason || '').trim();
            if (/отказ|не указал/i.test(r)) r = 'Отказ';
            else if (/самопризнан/i.test(r)) r = 'Признание';
            else if (/использован.*чит|читерств|чит/i.test(r)) r = 'Читы';
            else if (/обход/i.test(r)) r = 'Обход';
            else if (/Haron Anti-Cheat|AntiDLL|Anti-Cheat|^RAC$/i.test(r)) r = 'AC';
            else if (/нарушен/i.test(r)) r = 'Нарушение';
            else if (r.length > 20) r = r.substring(0, 20) + '…';
            detail = r || detail;
        }
        if (b.extra) detail += ` (${b.extra})`;
        const receivedAt = formatBanReceivedDate(b.receivedAt || b.date || b.created || b.timestamp);
        if (receivedAt) detail += ` • получен: ${receivedAt}`;
        return `<div class="flex items-center gap-2 p-2.5 rounded-lg ${bgClass}">${ico}<span class="${textClass} text-xs font-semibold">${b.source}</span><span class="text-gray-400 text-xs">${detail}</span></div>`;
    }).join('') : '<p class="text-emerald-400/70 text-xs">Нет банов</p>';

    const isOnline = p.online || (f?.stats?.online === 1);
    const serverName = p.serverName || '';
    const currentGame = s?.currentGame || null;
    const serverGameIcon = serverGameIconHtml(p.serverGame);
    let statusHtml;
    if (isOnline) statusHtml = `<span class="text-emerald-400 text-xs font-semibold">● Онлайн</span>${serverName ? ` <span class="text-gray-500 text-xs ml-1 inline-flex items-center gap-1">${serverGameIcon}<span>на ${serverName}</span></span>` : ''}`;
    else if (currentGame) statusHtml = `<span class="text-emerald-400 text-xs font-semibold">● В игре</span> <span class="text-gray-500 text-xs ml-1">${currentGame}</span>`;
    else {
        const lastOff = s?.lastLogoff ? formatAccountAge(s.lastLogoff) : null;
        statusHtml = `<span class="text-gray-500 text-xs">● Оффлайн</span>${lastOff ? ` <span class="text-gray-600 text-xs ml-1">был ${lastOff}</span>` : ''}`;
    }

    const accDate = p.accountCreated ? formatAccountAge(p.accountCreated) : '—';
    const whitelistBadge = p.whitelisted ? '<span class="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs font-semibold rounded-full">Чист</span>' : '';
    const kills = f?.stats?.kills ?? p.kills;
    const deaths = f?.stats?.deaths ?? p.deaths;
    const kd = kills !== undefined ? (deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(0)) : null;
    const playtimeH = f?.stats?.playtime ? Math.round(f.stats.playtime / 3600 * 10) / 10 : null;
    const lastConnect = f?.stats?.lastconnect ? formatAccountAge(f.stats.lastconnect) : null;
    const adminGroup = f?.adminGroup?.group_name || null;
    const vipGroupMap = { premium: 'Премиум', vip: 'VIP', 'vip+': 'VIP+' };
    const vip = f?.vipInfo?.isVip ? (vipGroupMap[f.vipInfo.group] || f.vipInfo.group) : null;
    const hs = f?.stats?.headshots ?? null;
    const hsPercent = (kills && hs !== null) ? Math.round((hs / kills) * 100) : null;
    const steamLvl = s?.steamLevel;
    const cs2Hours = s?.cs2Hours;
    const friendCount = s?.friendCount;
    const profileVis = s?.profileVisibility;
    const country = s?.country;
    const lvlColor = steamLvl !== null ? (steamLvl < 5 ? 'text-rose-400' : steamLvl < 15 ? 'text-amber-400' : 'text-emerald-400') : '';
    const friendColor = friendCount !== null ? (friendCount < 5 ? 'text-rose-400' : friendCount < 20 ? 'text-amber-400' : 'text-white') : '';
    const visText = profileVis === 3 ? 'Публичный' : profileVis === 1 ? 'Приватный' : profileVis ? 'Скрытый' : null;
    const visColor = profileVis === 3 ? 'text-emerald-400' : 'text-rose-400';

    const cardClass = 'p-2.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.06] transition-colors';
    const statsCards = [];
    if (kd !== null) statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">K/D</span><div class="text-white font-semibold mt-0.5">${kd} <span class="text-gray-600 text-[10px]">(${kills}/${deaths})</span></div></div>`);
    if (hsPercent !== null) statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">HS%</span><div class="text-white font-semibold mt-0.5">${hsPercent}%</div></div>`);
    if (accDate !== '—') statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">Регистрация</span><div class="text-white font-semibold mt-0.5">${accDate}</div></div>`);
    if (steamLvl !== null && steamLvl !== undefined) statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">Steam Lvl</span><div class="${lvlColor} font-semibold mt-0.5">${steamLvl}</div></div>`);
    if (cs2Hours !== null && cs2Hours !== undefined) statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">CS2</span><div class="text-white font-semibold mt-0.5">${cs2Hours}ч${cs2Hours === 0 ? ' <span class="text-gray-500 text-[10px]">(могут быть скрыты)</span>' : ''}</div></div>`);
    const friendsClick = forModal ? `onclick="closePlayerModal(); openFriendsModal('${steamId}')"` : `onclick="openFriendsModal('${steamId}')"`;
    if (friendCount !== null) statsCards.push(`<div class="${cardClass}" ${friendsClick} title="Список друзей"><span class="text-gray-500">Друзья</span><div class="${friendColor} font-semibold mt-0.5">${friendCount}</div></div>`);
    if (playtimeH !== null) statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">Наиграно</span><div class="text-white font-semibold mt-0.5">${playtimeH}ч</div></div>`);
    if (lastConnect) statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">Последний вход</span><div class="text-white font-semibold mt-0.5">${lastConnect}</div></div>`);
    if (visText) statsCards.push(`<div class="${cardClass}"><span class="text-gray-500">Профиль</span><div class="${visColor} font-semibold mt-0.5">${visText}</div></div>`);
    if (fc?.faceitLevel) {
        const flColor = getFaceitLevelColor(fc.faceitLevel);
        const faceitUrl = fc.faceitUrl || `https://www.faceit.com/en/players-modal/${steamId}`;
        statsCards.push(`<a href="${faceitUrl}" target="_blank" class="${cardClass} block" title="Перейти в Faceit"><span class="text-gray-500">Faceit</span><div class="flex items-center gap-1 font-semibold mt-0.5" style="color:${flColor}"><img src="/images/lvl${fc.faceitLevel}.svg" class="w-4 h-4">Lvl ${fc.faceitLevel}${fc.faceitElo ? ` <span class="text-gray-500 text-[10px]">(${fc.faceitElo} ELO)</span>` : ''}</div></a>`);
    }
    const badges = [];
    if (adminGroup) badges.push(`<span class="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs font-semibold rounded-full">${adminGroup}</span>`);
    if (vip) badges.push(`<span class="px-2 py-0.5 bg-purple-500/10 text-purple-400 text-xs font-semibold rounded-full">${vip}</span>`);
    const countryFlag = country ? `<img src="https://flagcdn.com/16x12/${country.toLowerCase()}.png" class="inline-block mr-1" alt="${country}">` : '';

    const countrySpan = country ? `<span class="text-gray-600 text-xs ml-auto">${countryFlag}${country}</span>` : '';
    return { nick, avatar, bansHtml, statsCards, statusHtml, badges, countrySpan, whitelistBadge };
}

function renderCheckPartial(localData, result, steamId) {
    const p = localData.local || {};
    const nick = p.nickname || 'Unknown';
    const avatar = p.avatar || DEFAULT_AVATAR;
    const gameIco = serverGameIconHtml(p.serverGame);
    const bansHtml = (p.bans || []).length > 0
        ? (p.bans || []).map(b => `<div class="flex items-center gap-2 p-2.5 rounded-lg bg-rose-500/10"><span class="text-rose-400 text-xs font-semibold">${b.source}</span><span class="text-gray-400 text-xs">${b.reason || '—'}</span></div>`).join('')
        : '<p class="text-gray-500 text-xs">Загрузка банов...</p>';
    result.innerHTML = `
        <div class="flex items-center gap-4 mb-5">
            <img src="${avatar}" class="w-16 h-16 rounded-full ring-2 ring-white/10" onerror="this.src='${DEFAULT_AVATAR}'">
            <div class="min-w-0 flex-1">
                <div class="text-white text-lg font-bold truncate">${nick}</div>
                <div class="text-gray-500 text-xs font-mono">${steamId}</div>
                    ${p.online ? `<div class="text-emerald-400 text-xs mt-1 inline-flex items-center gap-1">${gameIco}● Онлайн на ${p.serverName || 'сервере'}</div>` : ''}
            </div>
        </div>
        <div class="mb-5"><h4 class="text-gray-400 text-xs font-semibold mb-2">Баны</h4><div class="space-y-1.5">${bansHtml}</div></div>
        <div class="flex items-center justify-center gap-2 py-3"><div class="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div><span class="text-gray-500 text-sm">Загрузка остальных данных...</span></div>`;
}

function renderCheckFromMergedPlayer(p, result, steamId) {
    const nick = p.nickname || 'Unknown';
    const avatar = p.avatar || DEFAULT_AVATAR;
    const whitelistBadge = p.whitelisted ? '<span class="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs font-semibold rounded-full">Чист</span>' : '';
    const bansHtml = buildBansFromMergedPlayer(p);
    const gameIco = serverGameIconHtml(p.serverGame);
    const statusHtml = p.online ? `<span class="text-emerald-400 text-xs font-semibold">● Онлайн</span>${p.serverName ? ` <span class="text-gray-500 text-xs ml-1 inline-flex items-center gap-1">${gameIco}<span>на ${p.serverName}</span></span>` : ''}` : '';
    result.innerHTML = `
        <div class="flex items-center gap-4 mb-5">
            <img src="${avatar}" class="w-16 h-16 rounded-full ring-2 ring-white/10" onerror="this.src='${DEFAULT_AVATAR}'">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-white text-lg font-bold truncate">${nick}</span>
                    ${whitelistBadge}
                </div>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-gray-500 text-xs font-mono">${steamId}</span>
                    <a href="https://fearproject.ru/profile/${steamId}" target="_blank" class="px-2 py-0.5 bg-[#5865F2] hover:bg-[#4752C4] text-white text-[10px] font-semibold rounded transition-colors">FEAR</a>
                    <a href="https://steamcommunity.com/profiles/${steamId}" target="_blank" class="px-2 py-0.5 bg-[#171a21] hover:bg-[#1b2838] text-white text-[10px] font-semibold rounded transition-colors">Steam</a>
                </div>
                <div class="flex items-center gap-2 mt-1">${statusHtml}</div>
            </div>
        </div>
        <div class="mb-5"><h4 class="text-gray-400 text-xs font-semibold mb-2">Баны</h4><div class="space-y-1.5">${bansHtml}</div></div>
        <div class="flex items-center justify-center gap-2 py-3"><div class="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div><span class="text-gray-500 text-sm">Загрузка полных данных...</span></div>`;
}

async function runPlayerCheck() {
    const input = document.getElementById('checkInput');
    const result = document.getElementById('checkResult');
    if (!input || !result) return;
    const steamId = input.value.trim();
    if (!steamId || !/^\d{5,}$/.test(steamId)) {
        result.innerHTML = '<p class="text-amber-400">Введите корректный SteamID</p>';
        return;
    }

    const fullPromise = fetch(`/api/check/${steamId}`);
    const merged = mergeAllPlayersWithBans(state.allPlayers.players || []);
    const mergedPlayer = merged.find(x => String(x.steamId) === steamId);
    if (mergedPlayer) {
        renderCheckFromMergedPlayer(mergedPlayer, result, steamId);
    } else {
        result.innerHTML = `<div class="flex items-center justify-center gap-2 py-4"><div class="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div><span class="text-gray-500 text-sm">Загрузка...</span></div>`;
        const localData = await fetch(`/api/check/${steamId}?local=1`).then(r => r.json()).catch(() => ({ local: {} }));
        if (localData.local && (localData.local.nickname || localData.local.bans?.length > 0)) {
            renderCheckPartial(localData, result, steamId);
        }
    }

    try {
        const res = await fullPromise;
        const checkData = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 401) result.innerHTML = '<p class="text-amber-400">Сессия истекла. Войдите снова.</p>';
            else if (res.status >= 500) result.innerHTML = '<p class="text-rose-400">Ошибка сервера. Попробуйте позже.</p>';
            else result.innerHTML = `<p class="text-rose-400">Ошибка: ${(checkData.error || res.status)}</p>`;
            return;
        }
        if (checkData.error) throw new Error(checkData.error);
        const d = processCheckData(checkData, steamId);

        result.innerHTML = `
            <div class="flex items-center gap-4 mb-5">
                <img src="${d.avatar}" class="w-16 h-16 rounded-full ring-2 ring-white/10" onerror="this.src='${DEFAULT_AVATAR}'">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-white text-lg font-bold truncate">${d.nick}</span>
                        ${d.whitelistBadge}
                        ${d.badges.join('')}
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                        <span class="text-gray-500 text-xs font-mono">${steamId}</span>
                        <a href="https://fearproject.ru/profile/${steamId}" target="_blank" class="px-2 py-0.5 bg-[#5865F2] hover:bg-[#4752C4] text-white text-[10px] font-semibold rounded transition-colors">FEAR</a>
                        <a href="https://steamcommunity.com/profiles/${steamId}" target="_blank" class="px-2 py-0.5 bg-[#171a21] hover:bg-[#1b2838] text-white text-[10px] font-semibold rounded transition-colors">Steam</a>
                    </div>
                    <div class="flex items-center gap-2 mt-1">${d.statusHtml}${d.countrySpan || ''}</div>
                </div>
            </div>
            ${d.statsCards.length > 0 ? `<div class="grid grid-cols-3 gap-2 mb-5 text-xs">${d.statsCards.join('')}</div>` : ''}
            <div>
                <h4 class="text-gray-400 text-xs font-semibold mb-2">Баны</h4>
                <div class="space-y-1.5">${d.bansHtml}</div>
            </div>`;
    } catch (err) {
        result.innerHTML = `<p class="text-rose-400">Ошибка загрузки${err?.message ? ': ' + err.message : ''}</p>`;
    }
}

function closePlayerModal() {
    const modal = document.getElementById('playerModal');
    if (modal) modal.classList.add('hidden');
}

async function openFriendsModal(steamId) {
    const modal = document.getElementById('friendsModal');
    const content = document.getElementById('friendsModalContent');
    if (!modal || !content) return;
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="flex items-center justify-center gap-2 py-6"><div class="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div><span class="text-gray-500 text-sm">Загрузка друзей...</span></div>';
    try {
        const res = await fetch(`/api/steam-friends/${steamId}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const friends = data.friends || [];
        if (friends.length === 0) {
            content.innerHTML = '<p class="text-gray-500 text-sm text-center py-6">Нет друзей или профиль скрыт</p>';
        } else {
            content.innerHTML = friends.map(f => `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04]">
                    <img src="${f.avatar || DEFAULT_AVATAR}" class="w-10 h-10 rounded-full" onerror="this.src='${DEFAULT_AVATAR}'">
                    <div class="min-w-0 flex-1">
                        <div class="text-white text-sm font-semibold truncate">${f.nickname || 'Unknown'}</div>
                        <div class="text-gray-500 text-xs font-mono">${f.steamId}</div>
                    </div>
                    <a href="https://steamcommunity.com/profiles/${f.steamId}" target="_blank" class="px-2 py-1 bg-[#171a21] hover:bg-[#1b2838] text-white text-xs rounded">Steam</a>
                    <button onclick="closeFriendsModal(); document.getElementById('checkInput').value='${f.steamId}'; runPlayerCheck();" class="px-2 py-1 bg-cyan-500/80 hover:bg-cyan-500 text-white text-xs rounded">Проверить</button>
                </div>
            `).join('');
        }
    } catch (err) {
        content.innerHTML = '<p class="text-rose-400 text-sm text-center py-6">Ошибка загрузки друзей</p>';
    }
}

function closeFriendsModal() {
    const modal = document.getElementById('friendsModal');
    if (modal) modal.classList.add('hidden');
}

// ——— Действия пользователя ———

function addToWhitelist(steamId, nickname) {
    if (!confirm(`Отметить игрока "${nickname}" как чистого?`)) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'add_to_whitelist', steamId, nickname }));
    }
}

function removeFromWhitelist(steamId, nickname) {
    if (!confirm(`Удалить "${nickname}" из whitelist?`)) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'remove_from_whitelist', steamId, nickname }));
    }
}

function requestPlayerGames(steamId) {
    const el = document.getElementById(`games-${steamId}`);
    if (el) el.innerHTML = '<span class="text-gray-500">Загрузка...</span>';
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_player_games', steamId }));
    }
}

// ——— Инициализация и авторизация ———

connectWebSocket();

// Контекстное меню для сортировки/фильтров по флагам
let _flagsMenuEl = null;

function closeFlagsMenu() {
    if (_flagsMenuEl) {
        _flagsMenuEl.classList.add('hidden');
    }
}

function openFlagsMenu(x, y) {
    if (!_flagsMenuEl) {
        _flagsMenuEl = document.createElement('div');
        _flagsMenuEl.id = 'flagsContextMenu';
        _flagsMenuEl.className = 'fixed z-[300] hidden rounded-xl bg-[#111827] border border-white/10 shadow-xl p-2 min-w-[220px]';
        document.body.appendChild(_flagsMenuEl);
    }
    const activeFilters = getSuspiciousFilters();
    const html = `
        <div class="text-[11px] text-gray-400 mb-1 px-1">Флаги банов (ПКМ по «По флагам»)</div>
        <div class="flex flex-wrap gap-1 mb-2">
            ${SUSPICIOUS_FILTER_SOURCES.map(s => {
                const active = activeFilters.includes(s.key);
                return `<button type="button" data-flag-key="${s.key}" class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg ${active ? s.activeClass : s.inactiveClass}"><img src="${s.icon}" class="w-3.5 h-3.5">${s.label}</button>`;
            }).join('')}
        </div>
        <div class="flex justify-between items-center px-1 text-[11px] text-gray-500">
            <button type="button" data-flags-reset class="hover:text-gray-300">Сбросить</button>
            <span>ЛКМ — включить/выключить</span>
        </div>
    `;
    _flagsMenuEl.innerHTML = html;
    const rect = _flagsMenuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;
    if (top + rect.height > vh - 8) top = vh - rect.height - 8;
    _flagsMenuEl.style.left = `${left}px`;
    _flagsMenuEl.style.top = `${top}px`;
    _flagsMenuEl.classList.remove('hidden');
}

// Проверка техработ — показывает табличку пользователям
(async function checkMaintenance() {
    try {
        const u = getCurrentUser();
        if ((u.level || 0) >= 5) return;
        try {
            const meRes = await apiFetch('/api/me');
            if (meRes.ok) {
                const me = await meRes.json();
                if ((me.level || 0) >= 5) return;
            }
        } catch (_) {}
        const res = await apiFetch('/api/maintenance');
        const { active, message } = await res.json();
        if (!active) return;
        let el = document.getElementById('maintenanceBanner');
        if (!el) {
            el = document.createElement('div');
            el.id = 'maintenanceBanner';
            el.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40';
            const txt = (message || 'Проводятся технические работы. Приносим извинения за неудобства.').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            el.innerHTML = '<div class="bg-[#1a1a1e] border border-amber-500/30 rounded-2xl p-6 max-w-md shadow-2xl text-center"><div class="text-amber-400 text-2xl mb-3"><i class="ph ph-wrench"></i></div><p class="text-amber-400 font-bold text-lg mb-2">ТЕХ. РАБОТЫ</p><p class="text-gray-300 text-sm">' + txt + '</p></div>';
            document.body.appendChild(el);
        }
        el.classList.remove('hidden');
        el.style.display = 'flex';
    } catch (_) {}
})();

async function checkUpdateNotice() {
    try {
        const res = await apiFetch('/api/update-notice');
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.active || !data?.message || !data?.id || data.id === '0') return;

        const user = getCurrentUser();
        const uid = user?.id || user?.username || 'anon';
        const seenKey = `updateNoticeSeen:${uid}`;
        const seenId = localStorage.getItem(seenKey);
        if (seenId === String(data.id)) return;

        const existing = document.getElementById('updateNoticeToast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'updateNoticeToast';
        toast.className = 'fixed right-5 bottom-5 z-[210] max-w-[420px] w-[min(420px,calc(100vw-32px))] glass-panel rounded-xl border border-cyan-500/25 p-4 shadow-2xl';
        toast.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="w-8 h-8 rounded-lg bg-cyan-500/15 text-cyan-300 flex items-center justify-center shrink-0">
                    <i class="ph ph-megaphone text-lg"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-cyan-300 text-sm font-semibold mb-1">Обновление</div>
                    <div class="text-gray-200 text-sm leading-relaxed break-words">${escapeHtml(String(data.message)).replace(/\n/g, '<br>')}</div>
                </div>
                <button type="button" id="closeUpdateNoticeToast" class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 flex items-center justify-center shrink-0" aria-label="Закрыть">
                    <i class="ph ph-x text-sm"></i>
                </button>
            </div>
        `;
        document.body.appendChild(toast);

        const closeBtn = document.getElementById('closeUpdateNoticeToast');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                localStorage.setItem(seenKey, String(data.id));
                toast.remove();
            });
        }
    } catch (_) {}
}

window.addEventListener('DOMContentLoaded', async () => {
    // Anti-flicker: reveal UI only after session init.
    const revealUi = () => { try { document.body.classList.remove('app-preload'); } catch (_) {} };
    const preloadTimer = setTimeout(revealUi, 2000);
    const path = window.location.pathname;
    if (path === '/auth' || path === '/auth/') {
        clearTimeout(preloadTimer);
        revealUi();
        return;
    }
    applyLocalSettings();
    loadRolesEditorAccessToken();
    try {
        const res = await apiFetch('/api/me');
        if (!res.ok) return; // apiFetch обработает 401 редиректом
        const data = await res.json().catch(() => ({}));
        const level = typeof data.level === 'number' ? data.level : 0;
        state.userLevel = level;
        if (data.id != null) state.userId = String(data.id);
        if (data.steamId) state.userSteamId = String(data.steamId);
        if (typeof data.launcherApiKey === 'string' && data.launcherApiKey) {
            state.launcherApiKey = data.launcherApiKey;
        }
        try {
            localStorage.setItem('user', JSON.stringify({
                id: data.id ?? null,
                username: data.username || '',
                displayName: data.displayName || '',
                level,
                steamId: data.steamId || null,
                expiresAt: null
            }));
        } catch (_) {}

        const adminPanel = document.getElementById('adminPanel');
        const loginButton = document.getElementById('loginButton');
        
        if (level >= 1) {
            if (adminPanel) {
                adminPanel.classList.remove('hidden');
                const nameEl = document.getElementById('userName');
                const avatarEl = document.getElementById('userAvatar');
                if (nameEl) nameEl.textContent = data.displayName || data.username || 'User';
                if (avatarEl) avatarEl.style.display = 'none';
                loadBoundSteamAvatar(state.userSteamId || data.steamId || '');
            }
            if (loginButton) loginButton.style.display = 'none';

            applyLevelRestrictions(level);
        } else {
            if (adminPanel) adminPanel.classList.add('hidden');
        }
        clearTimeout(preloadTimer);
        revealUi();
        checkUpdateNotice();
    } catch (err) {
        clearTimeout(preloadTimer);
        revealUi();
        localStorage.removeItem('user');
        window.location.href = '/auth';
    }
});

function applyLevelRestrictions(level) {
    if (level === 3) {
        state.punishments.staffTableMode = 'old';
    }
    // Уровни 1-2: нет логов, настройки только локальные (без управления пользователями)
    if (level < 3) {
        const logsLink = document.querySelector('a[href="/logs"]');
        if (logsLink) logsLink.style.display = 'none';
    }
    // Уровни 1-3: нет полного доступа к настройкам (управление пользователями)
    if (level < 4) {
        const settingsLink = document.querySelector('a[href="/settings"]');
        if (settingsLink) settingsLink.style.display = 'none';
    }
    // «Для лаунчера» — только уровень 5 (суперадмин)
    const launcherNav = document.getElementById('navItemLauncher');
    const changesNav = document.getElementById('navItemChanges');
    if (changesNav) {
        if (level >= 3) changesNav.classList.remove('hidden');
        else changesNav.classList.add('hidden');
    }
    if (launcherNav) {
        if (level >= 5) launcherNav.classList.remove('hidden');
        else launcherNav.classList.add('hidden');
    }
}

function logout() {
    apiFetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .catch((e) => { console.warn('Logout request failed:', e); });
    localStorage.removeItem('user');
    window.location.href = '/auth';
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (state.columnsMenuOpen) {
            state.columnsMenuOpen = false;
            scheduleRenderPanel();
            return;
        }
        if (state.filtersMenuOpen && isPlayersCategoryOpen()) {
            state.filtersMenuOpen = false;
            scheduleRenderPanel();
            return;
        }
        if (document.getElementById('localSettingsModal') && !document.getElementById('localSettingsModal').classList.contains('hidden')) closeLocalSettingsModal();
        else if (document.getElementById('friendsModal') && !document.getElementById('friendsModal').classList.contains('hidden')) closeFriendsModal();
        else closePlayerModal();
    }
});

document.addEventListener('click', (e) => {
    if (state.columnsMenuOpen && !e.target.closest('[data-columns-dropdown]')) {
        state.columnsMenuOpen = false;
        scheduleRenderPanel();
        return;
    }
    if (state.filtersMenuOpen && isPlayersCategoryOpen() && !e.target.closest('[data-players-filters-menu]') && !e.target.closest('[data-players-filters-toggle]')) {
        state.filtersMenuOpen = false;
        scheduleRenderPanel();
        return;
    }

    const btn = e.target.closest('[data-open-card]');
    if (btn && btn.dataset.openCard) {
        e.preventDefault();
        e.stopPropagation();
        openPlayerModal(btn.dataset.openCard);
    }

    const flagsBtn = e.target.closest('[data-flag-key]');
    if (flagsBtn) {
        const key = flagsBtn.getAttribute('data-flag-key');
        if (key) {
            toggleSuspiciousFilter(key);
        }
        return;
    }

    if (e.target.closest('#flagsContextMenu [data-flags-reset]')) {
        setSuspiciousFilters([]);
        refreshAllPlayersPanel(false);
        return;
    }

    if (_flagsMenuEl && !e.target.closest('#flagsContextMenu') && !e.target.closest('[data-flags-sort-button]')) {
        closeFlagsMenu();
    }

    const themeBtn = e.target.closest('[data-local-theme]');
    if (themeBtn) {
        const modal = document.getElementById('localSettingsModal');
        if (modal) {
            modal.dataset.theme = themeBtn.getAttribute('data-local-theme') || 'dark';
            setLocalGroupSelection('[data-local-theme]', 'data-local-theme', modal.dataset.theme);
        }
    }

    const animBtn = e.target.closest('[data-local-anim]');
    if (animBtn) {
        const modal = document.getElementById('localSettingsModal');
        if (modal) {
            modal.dataset.anim = animBtn.getAttribute('data-local-anim') || 'full';
            setLocalGroupSelection('[data-local-anim]', 'data-local-anim', modal.dataset.anim);
        }
    }

    const scrollBtn = e.target.closest('[data-local-scroll]');
    if (scrollBtn) {
        const modal = document.getElementById('localSettingsModal');
        if (modal) {
            modal.dataset.scroll = scrollBtn.getAttribute('data-local-scroll') || 'balanced';
            setLocalGroupSelection('[data-local-scroll]', 'data-local-scroll', modal.dataset.scroll);
        }
    }
});

document.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('[data-flags-sort-button]');
    if (btn) {
        e.preventDefault();
        openFlagsMenu(e.clientX, e.clientY);
    }
});

// ——— Карточка игрока ———

const checkPrefetchCache = new Map();
const PREFETCH_TTL = 30000;

function prefetchCheck(steamId) {
    if (!steamId || checkPrefetchCache.has(steamId)) return;
    checkPrefetchCache.set(steamId, { pending: true });
    fetch(`/api/check/${steamId}`)
        .then(r => r.json())
        .then(data => checkPrefetchCache.set(steamId, { data, ts: Date.now() }))
        .catch(() => checkPrefetchCache.delete(steamId));
}

function buildBansFromMergedPlayer(p) {
    const banClasses = { VAC: ['bg-rose-500/10', 'text-rose-400'], Yooma: ['bg-indigo-500/10', 'text-indigo-400'], DXD: ['bg-red-500/10', 'text-red-400'], CS2Red: ['bg-cyan-500/10', 'text-cyan-400'], Deti00: ['bg-teal-500/10', 'text-teal-400'], PrideCS2: ['bg-orange-500/10', 'text-orange-400'], Top2: ['bg-lime-500/10', 'text-lime-400'] };
    const icons = { VAC: '/images/valve.ico', Yooma: '/images/yooma-logo.png', DXD: '/images/dxdcs2.ico', CS2Red: '/images/cs2red.ico', Deti00: '/images/deti00.ico', PrideCS2: '/images/pridecs2.ico', Top2: '/images/top2.ico' };
    const bans = [];
    if (p.hasDXDCS) bans.push({ source: 'DXD', reason: (p.reason || 'DXD').substring(0, 20) });
    if (p.hasVAC) bans.push({ source: 'VAC', reason: 'Game ban' });
    if (p.hasYooma) bans.push({ source: 'Yooma', reason: (p.yoomaReason || 'Yooma').substring(0, 20) });
    if (p.hasCS2Red) bans.push({ source: 'CS2Red', reason: cs2redReason(p.cs2redReason) });
    if (p.hasDeti00) bans.push({ source: 'Deti00', reason: deti00Reason(p.deti00Reason) });
    if (p.hasPrideCS2) bans.push({ source: 'PrideCS2', reason: (p.pridecs2Reason || 'Pride').substring(0, 20) });
    if (p.hasTop2) bans.push({ source: 'Top2', reason: (p.top2Reason || 'Top2').substring(0, 20) });
    if (bans.length === 0) return '<p class="text-emerald-400/70 text-xs">Нет банов в кэше</p>';
    return bans.map(b => {
        const [bg, tc] = banClasses[b.source] || ['bg-gray-500/10', 'text-gray-400'];
        const ico = icons[b.source] ? `<img src="${icons[b.source]}" class="w-4 h-4">` : '';
        return `<div class="flex items-center gap-2 p-2.5 rounded-lg ${bg}">${ico}<span class="${tc} text-xs font-semibold">${b.source}</span><span class="text-gray-400 text-xs">${b.reason}</span></div>`;
    }).join('');
}

function renderModalFromMergedPlayer(p, content, steamId) {
    const nick = p.nickname || 'Unknown';
    const avatar = p.avatar || DEFAULT_AVATAR;
    const whitelistBadge = p.whitelisted ? '<span class="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs font-semibold rounded-full">Чист</span>' : '';
    const kills = p.kills || 0, deaths = p.deaths || 0;
    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
    const gameIco = serverGameIconHtml(p.serverGame);
    const statusHtml = p.online ? `<span class="text-emerald-400 text-xs font-semibold">● Онлайн</span>${p.serverName ? ` <span class="text-gray-500 text-xs ml-1 inline-flex items-center gap-1">${gameIco}<span>на ${p.serverName}</span></span>` : ''}` : '<span class="text-gray-500 text-xs">● Оффлайн</span>';
    const statsCards = [];
    if (kills !== undefined || deaths !== undefined) statsCards.push(`<div class="p-2.5 bg-white/[0.03] rounded-lg"><span class="text-gray-500">K/D</span><div class="text-white font-semibold mt-0.5">${kd} (${kills}/${deaths})</div></div>`);
    const bansHtml = buildBansFromMergedPlayer(p);
    content.innerHTML = `
        <div class="flex items-center gap-4 mb-5">
            <img src="${avatar}" class="w-16 h-16 rounded-full border-2 border-white/10" onerror="this.src='${DEFAULT_AVATAR}'">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="text-white text-lg font-bold truncate">${nick}</h3>
                    ${whitelistBadge}
                </div>
                <p class="text-gray-500 text-xs font-mono">${steamId}</p>
                <div class="flex gap-3 mt-1 text-xs items-center">${statusHtml}</div>
            </div>
            <button type="button" onclick="closePlayerModal()" class="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center shrink-0"><i class="ph ph-x text-gray-400"></i></button>
        </div>
        ${statsCards.length ? `<div class="grid grid-cols-3 gap-2 mb-5 text-xs">${statsCards.join('')}</div>` : ''}
        <div class="mb-4"><h4 class="text-white text-sm font-bold mb-2">Баны</h4><div class="space-y-2">${bansHtml}</div></div>
        <div class="flex items-center justify-center gap-2 py-3">
            <div class="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-gray-500 text-sm">Загрузка полных данных...</span>
        </div>`;
}

function renderModalPartial(localData, content, steamId) {
    const p = localData.local || {};
    const nick = p.nickname || 'Unknown';
    const avatar = p.avatar || DEFAULT_AVATAR;
    const bansHtml = (p.bans || []).length > 0
        ? (p.bans || []).map(b => `<div class="flex items-center gap-2 p-2 rounded-lg bg-rose-500/10"><span class="text-rose-400 text-xs font-semibold">${b.source}</span><span class="text-gray-400 text-xs">${b.reason || '—'}</span></div>`).join('')
        : '<p class="text-gray-500 text-sm">Нет банов в кэше</p>';
    const comments = (p.comments || []);
    const commentsHtml = comments.length > 0 ? comments.map(c => `
        <div class="p-2 bg-white/[0.03] rounded-lg">
            <div class="flex justify-between items-center mb-1">
                <span class="text-indigo-400 text-xs font-semibold">${(c.author_name || c.authorName || '—')}</span>
                <span class="text-gray-600 text-xs">${c.created_at ? new Date(c.created_at).toLocaleDateString('ru') : ''}</span>
            </div>
            <p class="text-gray-300 text-sm">${c.comment || ''}</p>
        </div>
    `).join('') : '';
    content.innerHTML = `
        <div class="flex items-center gap-4 mb-5">
            <img src="${avatar}" class="w-16 h-16 rounded-full border-2 border-white/10" onerror="this.src='${DEFAULT_AVATAR}'">
            <div class="min-w-0 flex-1">
                <h3 class="text-white text-lg font-bold truncate">${nick}</h3>
                <p class="text-gray-500 text-xs font-mono">${steamId}</p>
                ${p.online ? `<p class="text-emerald-400 text-xs mt-1">● Онлайн</p>` : ''}
            </div>
            <button type="button" onclick="closePlayerModal()" class="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center shrink-0">
                <i class="ph ph-x text-gray-400"></i>
            </button>
        </div>
        <div class="mb-4">
            <h4 class="text-white text-sm font-bold mb-2">Баны</h4>
            <div class="space-y-2">${bansHtml}</div>
        </div>
        <div class="mb-4">
            <h4 class="text-white text-sm font-bold mb-2">Комментарии</h4>
            <div class="space-y-2 mb-3">${commentsHtml || '<p class="text-gray-500 text-sm">Нет комментариев</p>'}</div>
        </div>
        <div class="flex items-center justify-center gap-2 py-3">
            <div class="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-gray-500 text-sm">Загрузка остальных данных...</span>
        </div>
    `;
}

async function openPlayerModal(steamId) {
    const modal = document.getElementById('playerModal');
    const content = document.getElementById('playerModalContent');
    if (!modal || !content) return;
    modal.classList.remove('hidden');
    modal.dataset.steamId = steamId;
    const searchResults = document.getElementById('searchResults');
    if (searchResults) searchResults.classList.add('hidden');

    const merged = mergeAllPlayersWithBans(state.allPlayers.players || []);
    const mergedPlayer = merged.find(x => String(x.steamId) === steamId);
    if (mergedPlayer) {
        content.innerHTML = '';
        renderModalFromMergedPlayer(mergedPlayer, content, steamId);
    } else {
        content.innerHTML = '<p class="text-gray-400 text-center py-8">Загрузка...</p>';
    }

    const cached = checkPrefetchCache.get(steamId);
    let checkData = null;
    if (cached && cached.data && !cached.pending && cached.ts && (Date.now() - cached.ts < PREFETCH_TTL) && !cached.data.error) {
        checkData = cached.data;
        checkPrefetchCache.delete(steamId);
    }

    try {
        if (!checkData) {
            const res = await fetch(`/api/check/${steamId}`);
            checkData = await res.json().catch(() => ({}));
            if (modal.dataset.steamId !== steamId) return;
            if (!res.ok) {
                if (res.status === 401) content.innerHTML = '<p class="text-amber-400 text-center py-8">Сессия истекла. Войдите снова.</p>';
                else if (res.status >= 500) content.innerHTML = '<p class="text-rose-400 text-center py-8">Ошибка сервера. Попробуйте позже.</p>';
                else content.innerHTML = `<p class="text-rose-400 text-center py-8">Ошибка: ${(checkData.error || res.status)}</p>`;
                return;
            }
        }
        if (modal.dataset.steamId !== steamId) return;
        if (checkData.error) {
            content.innerHTML = mergedPlayer
                ? content.innerHTML.replace(/Загрузка полных данных\.\.\./g, `<span class="text-amber-400">Не удалось загрузить полные данные: ${checkData.error}</span>`)
                : `<p class="text-rose-400 text-center py-8">Ошибка: ${checkData.error}</p>`;
            return;
        }

        let d;
        if (checkData) {
            d = processCheckData(checkData, steamId, true);
        } else {
            content.innerHTML = '<p class="text-rose-400 text-center py-8">Не удалось загрузить данные</p>';
            return;
        }

        const comments = (checkData.local?.comments || []);
        const commentsHtml = comments.length > 0 ? comments.map(c => `
            <div class="p-2 bg-white/[0.03] rounded-lg">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-indigo-400 text-xs font-semibold">${(c.author_name || c.authorName || '—')}</span>
                    <span class="text-gray-600 text-xs">${c.created_at ? new Date(c.created_at).toLocaleDateString('ru') : ''}</span>
                </div>
                <p class="text-gray-300 text-sm">${c.comment || ''}</p>
            </div>
        `).join('') : '';

        content.innerHTML = `
            <div class="flex items-center gap-4 mb-5">
                <img src="${d.avatar}" class="w-16 h-16 rounded-full border-2 border-white/10" onerror="this.src='${DEFAULT_AVATAR}'">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <h3 class="text-white text-lg font-bold truncate">${d.nick}</h3>
                        ${d.whitelistBadge}
                        ${d.badges.join('')}
                    </div>
                    <p class="text-gray-500 text-xs font-mono">${steamId}</p>
                    <div class="flex gap-3 mt-1 text-xs items-center">
                        ${d.statusHtml}
                        ${d.countrySpan}
                    </div>
                </div>
                <button type="button" onclick="closePlayerModal()" class="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center shrink-0">
                    <i class="ph ph-x text-gray-400"></i>
                </button>
            </div>
            ${d.statsCards.length > 0 ? `<div class="grid grid-cols-3 gap-2 mb-5 text-xs">${d.statsCards.join('')}</div>` : ''}
            <div class="mb-4">
                <h4 class="text-white text-sm font-bold mb-2">Баны</h4>
                <div class="space-y-2">${d.bansHtml}</div>
            </div>
            <div class="mb-4">
                <h4 class="text-white text-sm font-bold mb-2">Комментарии</h4>
                <div class="space-y-2 mb-3">${commentsHtml || '<p class="text-gray-500 text-sm">Нет комментариев</p>'}</div>
                <div class="flex gap-2">
                    <input type="text" id="commentInput" placeholder="Добавить комментарий..." class="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500">
                    <button type="button" onclick="addComment('${steamId}')" class="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold rounded-lg">Отправить</button>
                </div>
                <p id="commentError" class="text-rose-400 text-xs mt-1 min-h-[1rem]"></p>
            </div>
            <div class="flex gap-2">
                <a href="https://steamcommunity.com/profiles/${steamId}" target="_blank" class="flex-1 text-center px-3 py-2 bg-[#171a21] hover:bg-[#1b2838] text-white text-xs font-semibold rounded-lg">Steam</a>
                <a href="https://fearproject.ru/profile/${steamId}" target="_blank" class="flex-1 text-center px-3 py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold rounded-lg">FEAR</a>
            </div>
        `;
    } catch (err) {
        if (modal.dataset.steamId === steamId) {
            content.innerHTML = `<p class="text-rose-400 text-center py-8">Ошибка загрузки${err?.message ? ': ' + err.message : ''}</p>`;
        }
    }
}

async function addComment(steamId) {
    const input = document.getElementById('commentInput');
    const comment = input.value.trim();
    if (!comment) return;
    try {
        const res = await apiFetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steamId, comment })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = document.getElementById('commentError');
            if (err) err.textContent = data.error || 'Ошибка отправки';
            return;
        }
        const errEl = document.getElementById('commentError');
        if (errEl) errEl.textContent = '';
        input.value = '';
        openPlayerModal(steamId);
    } catch (_) {
        const err = document.getElementById('commentError');
        if (err) err.textContent = 'Ошибка сети';
    }
}

// ——— FEAR Reports counter ———

let _fearReportCount = 0;
let _fearReportWs = null;
let _fearReportsRaw = [];
const _fearReportsByPlayer = new Map();
let _fearReportsStarted = false;

function buildReportsByPlayer(reports) {
    _fearReportsByPlayer.clear();
    for (const r of reports) {
        if (r.result !== null) continue;
        const sid = r.intruder_steamid;
        if (!sid) continue;
        _fearReportsByPlayer.set(sid, (_fearReportsByPlayer.get(sid) || 0) + 1);
    }
}

function getPlayerReportCount(steamId) {
    return _fearReportsByPlayer.get(steamId) || 0;
}

function updateReportCountUI() {
    const el = document.getElementById('reportCount');
    if (el) el.textContent = _fearReportCount;
    document.querySelectorAll('[data-report-sid]').forEach(badge => {
        const sid = badge.dataset.reportSid;
        const cnt = getPlayerReportCount(sid);
        badge.textContent = cnt;
        badge.style.display = cnt > 0 ? '' : 'none';
    });
}

function fetchFearReports() {
    fetch('/api/fear-reports')
    .then(r => {
        if (!r.ok) {
            if (r.status === 401) console.warn('Fear reports: session expired');
            else if (r.status >= 500) console.warn('Fear reports: server error', r.status);
            return null;
        }
        return r.json();
    })
    .then(data => {
        if (data && Array.isArray(data)) {
            _fearReportsRaw = data;
            _fearReportCount = data.filter(r => r.result === null).length;
            buildReportsByPlayer(data);
            updateReportCountUI();
        }
    })
    .catch((e) => { console.warn('Fear reports fetch failed:', e); });
}

function initFearReports() {
    fetchFearReports();
    connectFearReportWs();
    setInterval(fetchFearReports, 60000);
}

function startFearReportsIfNeeded() {
    if (_fearReportsStarted) return;
    _fearReportsStarted = true;
    // Не блокируем первый рендер — стартуем после отрисовки панели
    setTimeout(initFearReports, 50);
}

function connectFearReportWs() {
    if (_fearReportWs) { try { _fearReportWs.close(); } catch(_){} }
    _fearReportWs = new WebSocket('wss://api.fearproject.ru/socket.io/?EIO=4&transport=websocket');
    _fearReportWs.onopen = () => {
        _fearReportWs.send('40');
    };
    _fearReportWs.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith('42')) {
            try {
                const payload = JSON.parse(msg.slice(2));
                if (payload[0] === 'newReport') {
                    _fearReportCount++;
                    updateReportCountUI();
                } else if (payload[0] === 'reportAccepted' || payload[0] === 'reportResolved' || payload[0] === 'reportClosed') {
                    _fearReportCount = Math.max(0, _fearReportCount - 1);
                    updateReportCountUI();
                }
            } catch(_) {}
        }
    };
    _fearReportWs.onclose = () => {
        setTimeout(connectFearReportWs, 10000);
    };
    _fearReportWs.onerror = () => {
        try { _fearReportWs.close(); } catch(_) {}
    };
}

function initSmoothWheelScrolling() {
    if (document.documentElement.dataset.smoothWheelReady === '1') return;
    document.documentElement.dataset.smoothWheelReady = '1';

    const EASE = 0.38;
    const stateByEl = new WeakMap();
    let rafScheduled = false;
    const pendingEls = new Set();

    const getScrollParent = (start) =>
        (start && start.closest ? start.closest('[data-smooth-scroll-container="1"]') : null)
        || document.scrollingElement
        || document.documentElement;

    function tick() {
        rafScheduled = false;
        const mode = window.__smoothWheelMode || 'glide';
        if (mode !== 'glide') { pendingEls.clear(); return; }

        for (const el of [...pendingEls]) {
            const st = stateByEl.get(el);
            if (!st) { pendingEls.delete(el); continue; }
            const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
            if (maxTop <= 0) { st.rafId = 0; pendingEls.delete(el); continue; }
            const diff = st.target - el.scrollTop;
            if (Math.abs(diff) < 1) {
                el.scrollTop = st.target;
                st.rafId = 0;
                pendingEls.delete(el);
                continue;
            }
            el.scrollTop += diff * EASE;
        }

        if (pendingEls.size > 0 && !rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(tick);
        }
    }

    let wheelThrottle = 0;
    document.addEventListener('wheel', (e) => {
        if (window.__smoothWheelEnabled !== true) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if ((window.__smoothWheelMode || '') !== 'glide') return;
        // Do not hijack wheel inside dropdown menus (they must scroll natively).
        if (e.target && e.target.closest && e.target.closest('.ui-select-menu')) return;
        const el = getScrollParent(e.target);
        if (!el) return;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        if (maxTop <= 0) return;

        let st = stateByEl.get(el);
        if (!st) {
            st = { target: el.scrollTop, rafId: 1 };
            stateByEl.set(el, st);
        }

        const now = Date.now();
        if (now - wheelThrottle < 16) return;
        wheelThrottle = now;

        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16;
        else if (e.deltaMode === 2) delta *= el.clientHeight * 0.2;
        delta = Math.max(-120, Math.min(120, delta * 1.0));
        if (Math.abs(delta) < 2) return;

        e.preventDefault();
        st.target = Math.min(maxTop, Math.max(0, st.target + delta));
        st.rafId = 1;
        pendingEls.add(el);
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(tick);
        }
    }, { passive: false });
}

applyLocalSettings();
initSmoothWheelScrolling();
