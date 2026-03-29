/**
 * Модуль авторизации и управления сессиями
 * Сессии хранятся в БД — переживают перезапуск сервера и обновление страницы
 */

const crypto = require('crypto');
const db = require('./database');

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 дней

/**
 * Генерация безопасного session token
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function rowToSession(row) {
    if (!row) return null;
    return {
        token: row.token,
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        level: row.level,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastActivity: row.last_activity
    };
}

/**
 * Создание новой сессии для пользователя (логин/пароль)
 */
function createSession(userData) {
    const sessionToken = generateSessionToken();
    const now = Date.now();
    const expiresAt = now + SESSION_TTL;
    
    db.saveSession(sessionToken, userData.id, userData.username, userData.displayName || userData.username, userData.level, expiresAt, now, now);
    
    return {
        token: sessionToken,
        userId: userData.id,
        username: userData.username,
        displayName: userData.displayName || userData.username,
        level: userData.level,
        createdAt: now,
        expiresAt,
        lastActivity: now
    };
}

/**
 * Получение сессии по токену
 */
function getSession(sessionToken) {
    if (!sessionToken) return null;
    
    const row = db.getSessionFromDb(sessionToken);
    const session = rowToSession(row);
    if (!session) return null;
    
    if (Date.now() > session.expiresAt) {
        db.deleteSessionFromDb(sessionToken);
        return null;
    }

    // Синхронизируем уровень с актуальным значением из БД,
    // чтобы изменения прав применялись без перелогина.
    try {
        const user = db.getUserById(session.userId);
        if (user && Number.isFinite(Number(user.level))) {
            session.level = Number(user.level);
        }
    } catch (_) {}

    db.saveSession(sessionToken, session.userId, session.username, session.displayName, session.level, session.expiresAt, session.createdAt, Date.now());
    session.lastActivity = Date.now();
    return session;
}

/**
 * Удаление сессии (logout)
 */
function deleteSession(sessionToken) {
    db.deleteSessionFromDb(sessionToken);
    return true;
}

/**
 * Валидация сессии и проверка прав
 */
function validateSession(sessionToken, requiredLevel = 0) {
    const session = getSession(sessionToken);
    
    if (!session) {
        return { valid: false, error: 'Сессия не найдена или истекла' };
    }
    
    if (session.level < requiredLevel) {
        return { valid: false, error: 'Недостаточно прав' };
    }
    
    return { valid: true, session };
}

/**
 * Очистка истекших сессий
 */
function cleanupExpiredSessions() {
    const cleaned = db.cleanupExpiredSessionsDb();
    if (cleaned > 0) {
        console.log(`[Auth] Очищено истекших сессий: ${cleaned}`);
    }
    return cleaned;
}

function getSessionStats() {
    const now = Date.now();
    const rows = db.getActiveSessionsFromDb();
    const activeSessions = rows.map(row => rowToSession(row));
    
    return {
        total: activeSessions.length,
        active: activeSessions.filter(s => now - s.lastActivity < 5 * 60 * 1000).length,
        oldest: activeSessions.length > 0 ? Math.min(...activeSessions.map(s => s.createdAt)) : null,
        newest: activeSessions.length > 0 ? Math.max(...activeSessions.map(s => s.createdAt)) : null
    };
}

setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

module.exports = {
    createSession,
    getSession,
    deleteSession,
    validateSession,
    cleanupExpiredSessions,
    getSessionStats
};
