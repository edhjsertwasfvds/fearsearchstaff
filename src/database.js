/**
 * Хранилище панели: PostgreSQL при заданном DATABASE_URL (та же БД, что VibeCodingBdd),
 * иначе локальный SQLite (databaseSqlite.js).
 */
'use strict';

function panelPostgresEnabled() {
    return Boolean(String(process.env.DATABASE_URL || '').trim());
}

const sqlite = require('./databaseSqlite');

if (panelPostgresEnabled()) {
    const pg = require('./databasePostgres');
    module.exports = Object.assign({ backend: 'postgres' }, pg);
} else {
    const out = { backend: 'sqlite' };
    for (const key of Object.keys(sqlite)) {
        const fn = sqlite[key];
        if (typeof fn !== 'function') {
            out[key] = fn;
            continue;
        }
        out[key] = (...args) => {
            try {
                const r = fn(...args);
                return r && typeof r.then === 'function' ? r : Promise.resolve(r);
            } catch (e) {
                return Promise.reject(e);
            }
        };
    }
    module.exports = out;
}
