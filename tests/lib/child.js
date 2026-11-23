// Separate node processes: "after a restart", "from two places at once", "with other settings".
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIB } from './paths.js';
import { assertSut, sutFile } from './sut.js';
import { enc, dec } from './wire.js';

function childEnv(overrides) {
    const env = { ...process.env };
    for (const [k, v] of Object.entries(overrides || {})) {
        if (v === null || v === undefined) delete env[k]; else env[k] = String(v);
    }
    return env;
}

/**
 * Calls sf-daily/<mod>.js export <name>(...args) in a fresh node process.
 * Resolves { ok: true, value } or { ok: false, error: { name, message, isTypeError, isError } }.
 * `signal` (AbortSignal): aborting it SIGKILLs the child mid-call; the call then resolves { ok: false, killed: true }.
 * Throws if the module is missing (so the calling test fails as SUT_MISSING).
 */
export function callInChild(mod, name, args = [], { env, timeoutMs = 30_000, signal } = {}) {
    assertSut(mod);
    return new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [path.join(LIB, 'child-entry.js')], {
            env: childEnv({ ...env, GATE_CHILD_CALL: JSON.stringify({ mod, name, args: enc(args) }) }),
            stdio: ['ignore', 'pipe', 'pipe'],
            ...(signal ? { signal, killSignal: 'SIGKILL' } : {}),
        });
        p.on('error', () => {}); // an aborted spawn reports AbortError here; 'close' still follows
        let out = '';
        let err = '';
        p.stdout.on('data', (b) => { out += b; });
        p.stderr.on('data', (b) => { err += b; });
        const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`child ${mod}.${name} timed out\n${err}`)); }, timeoutMs);
        p.on('close', () => {
            clearTimeout(timer);
            if (signal?.aborted) return resolve({ ok: false, killed: true });
            const m = out.match(/__GATE_RESULT__(.*)\n/);
            if (!m) return reject(new Error(`child ${mod}.${name} gave no result\nstdout:${out}\nstderr:${err}`));
            const r = JSON.parse(m[1]);
            if (r.loadFailed) return reject(new Error(r.error.message));
            if (r.ok) r.value = dec(r.value);
            resolve(r);
        });
    });
}

/**
 * Starts the sf-daily service (node sf-daily/main.js) with exactly `env` on top of the inherited
 * harness environment (null deletes). Returns a handle to watch output and exit.
 * `fakeNow` (Date | ISO) moves the process's wall clock there through the fake-clock.js preload
 * (no sf-daily setting involved); `fakeRate` makes it run that many times faster than real time.
 */
export function startService(env = {}, { fakeNow = null, fakeRate = 1 } = {}) {
    assertSut('main');
    const base = childEnv({});
    for (const k of Object.keys(base)) if (/^(SF_|SMTP_|PG_|GATE_)/.test(k)) delete base[k];
    const merged = { ...base };
    for (const [k, v] of Object.entries(env)) if (v !== null && v !== undefined) merged[k] = String(v);
    const argv = [sutFile('main')];
    if (fakeNow) {
        merged.GATE_FAKE_NOW = new Date(fakeNow).toISOString();
        merged.GATE_FAKE_RATE = String(fakeRate);
        argv.unshift('--import', pathToFileURL(path.join(LIB, 'fake-clock.js')).href);
    }
    const p = spawn(process.execPath, argv, { env: merged, stdio: ['ignore', 'pipe', 'pipe'] });
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let exit = null;
    let exitAt = null;
    const lines = []; // { at: real ms when the line arrived, text } — stdout and stderr
    const partial = { out: '', err: '' };
    const take = (k, b) => {
        partial[k] += b;
        const parts = partial[k].split('\n');
        partial[k] = parts.pop();
        for (const text of parts) lines.push({ at: Date.now(), text });
    };
    const exited = new Promise((r) => p.on('close', (code, signal) => { exitAt = Date.now(); exit = { code, signal }; r(exit); }));
    p.stdout.on('data', (b) => { stdout += b; take('out', String(b)); });
    p.stderr.on('data', (b) => { stderr += b; take('err', String(b)); });
    return {
        startedAt,
        lines,
        get stdout() { return stdout; },
        get stderr() { return stderr; },
        get output() { return stdout + stderr; },
        get exit() { return exit; },
        /** Real ms when the process ended (null while running). */
        get exitAt() { return exitAt; },
        /** Sends a signal and returns at once. */
        kill(sig = 'SIGTERM') { if (!exit) p.kill(sig); },
        /** Resolves the exit record, or null if still running after ms. */
        async waitExit(ms) {
            return Promise.race([exited, new Promise((r) => setTimeout(() => r(null), ms))]);
        },
        async stop() {
            if (exit) return exit;
            p.kill('SIGTERM');
            const r = await Promise.race([exited, new Promise((res) => setTimeout(() => res(null), 3000))]);
            if (!r) { p.kill('SIGKILL'); await exited; }
            return exit;
        },
    };
}
