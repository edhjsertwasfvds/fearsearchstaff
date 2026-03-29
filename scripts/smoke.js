const { spawn } = require('child_process');
const WebSocket = require('ws');

const SMOKE_PORT = process.env.SMOKE_PORT || '3101';
const BASE_URL = `http://127.0.0.1:${SMOKE_PORT}`;
const WS_URL = `ws://127.0.0.1:${SMOKE_PORT}`;
const START_TIMEOUT_MS = 45000;

const smokeUser = process.env.ADMIN_USERNAME || 'smoke_admin';
const smokePass = process.env.ADMIN_PASSWORD || 'smoke_password_123';
const REQUIRED_ENV = {
    ADMIN_USERNAME: smokeUser,
    ADMIN_PASSWORD: smokePass,
    DEFAULT_USERS: `${smokeUser}:${smokePass}:5`,
    NODE_ENV: process.env.NODE_ENV || 'test',
    PORT: SMOKE_PORT
};

let serverProcess = null;
let recentLogs = [];

function pushLog(line) {
    recentLogs.push(line);
    if (recentLogs.length > 80) {
        recentLogs = recentLogs.slice(-80);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < START_TIMEOUT_MS) {
        try {
            const res = await fetch(`${BASE_URL}/`);
            if (res.status === 200) {
                return;
            }
        } catch (err) {
            // server is still starting
        }
        await sleep(500);
    }
    throw new Error(`Server did not start within ${START_TIMEOUT_MS}ms`);
}

function printResult(ok, title, details = '') {
    const icon = ok ? 'PASS' : 'FAIL';
    const suffix = details ? ` - ${details}` : '';
    console.log(`[${icon}] ${title}${suffix}`);
}

async function httpCheck(name, path, expectedStatus, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, options);
    const body = await res.text();
    const isOk = res.status === expectedStatus;
    printResult(isOk, `HTTP ${name}`, `status=${res.status}`);
    if (!isOk) {
        throw new Error(`Unexpected status for ${path}. Expected ${expectedStatus}, got ${res.status}. Body: ${body.slice(0, 200)}`);
    }
}

async function httpPostJsonCheck(name, path, payload, expectedStatus) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload)
    });
    const body = await res.text();
    const isOk = res.status === expectedStatus;
    printResult(isOk, `HTTP ${name}`, `status=${res.status}`);
    if (!isOk) {
        throw new Error(`Unexpected status for ${path}. Expected ${expectedStatus}, got ${res.status}. Body: ${body.slice(0, 200)}`);
    }
}

function wsCheck(name, requestPayload, expectedType) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            ws.close();
            reject(new Error(`WebSocket timeout for ${name}`));
        }, 12000);

        ws.on('open', () => {
            ws.send(JSON.stringify(requestPayload));
        });

        ws.on('message', (raw) => {
            let data;
            try {
                data = JSON.parse(raw.toString());
            } catch (err) {
                return;
            }

            if (data.type === expectedType) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                printResult(true, `WS ${name}`, `type=${data.type}`);
                ws.close();
                resolve();
            }
        });

        ws.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(err);
        });
    });
}

async function runChecks() {
    await httpCheck('home page', '/', 200);
    await httpCheck('whitelist without auth', '/api/whitelist', 401);
    await httpCheck('logs without auth', '/api/logs', 403);
    await httpCheck('auth page', '/auth', 200);
    await httpPostJsonCheck('login wrong creds', '/api/auth/login', { username: 'bad', password: 'bad' }, 401);
    await httpPostJsonCheck('login success', '/api/auth/login', { username: smokeUser, password: smokePass }, 200);

    await httpPostJsonCheck('auth session invalid token', '/api/auth/session', { sessionToken: 'fake_token' }, 401);
    await httpPostJsonCheck('auth logout invalid token', '/api/auth/logout', { sessionToken: 'fake_token' }, 200);
    await httpPostJsonCheck('auth session invalid json', '/api/auth/session', '{bad json', 400);

    await wsCheck('get_stats', { type: 'get_stats' }, 'stats');
    await wsCheck('get_vac_bans', { type: 'get_vac_bans' }, 'vac_bans');
    await wsCheck('get_yooma_bans', { type: 'get_yooma_bans' }, 'yooma_bans');
    await wsCheck('get_suspicious_bans', { type: 'get_suspicious_bans' }, 'suspicious_bans');
    await wsCheck('get_account_age_batch', { type: 'get_account_age_batch', steamIds: ['76561198000000000'] }, 'account_age_batch');
}

function stopServer() {
    return new Promise((resolve) => {
        if (!serverProcess || serverProcess.killed) {
            resolve();
            return;
        }

        const done = () => resolve();
        serverProcess.once('exit', done);
        serverProcess.kill('SIGTERM');

        setTimeout(() => {
            if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGKILL');
            }
            resolve();
        }, 3000);
    });
}

async function main() {
    console.log(`Starting smoke test server on port ${SMOKE_PORT}...`);

    serverProcess = spawn(process.execPath, ['src/server.js'], {
        env: { ...process.env, ...REQUIRED_ENV },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (chunk) => {
        const line = chunk.toString().trim();
        if (line) pushLog(`[server] ${line}`);
    });

    serverProcess.stderr.on('data', (chunk) => {
        const line = chunk.toString().trim();
        if (line) pushLog(`[server:err] ${line}`);
    });

    try {
        await waitForServer();
        console.log(`Server is up at ${BASE_URL}`);
        await runChecks();
        console.log('Smoke tests completed successfully.');
    } catch (err) {
        console.error(`Smoke tests failed: ${err.message}`);
        if (recentLogs.length > 0) {
            console.error('\nLast server logs:');
            for (const line of recentLogs.slice(-20)) {
                console.error(line);
            }
        }
        process.exitCode = 1;
    } finally {
        await stopServer();
    }
}

main();
