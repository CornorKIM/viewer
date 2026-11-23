// Local stand-in for Vercel: serves the Vite build (dist/) and runs api/*.js handlers
// with the Vercel Node helpers they rely on (req.query, req.body, res.status/json/send).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const API = path.join(ROOT, 'api');
const PORT = Number(process.env.PORT) || 3000;
const TRUSTED_PROXIES = new Set((process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean));

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm',
    '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function parseBody(buf, type = '') {
    if (!buf.length) return undefined;
    const text = buf.toString('utf8');
    if (type.includes('application/json')) {
        try { return JSON.parse(text); } catch { return text; }
    }
    if (type.includes('application/x-www-form-urlencoded')) {
        return Object.fromEntries(new URLSearchParams(text));
    }
    if (type.startsWith('text/')) return text;
    return buf;
}

function parseCookies(header = '') {
    const out = {};
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

function addResHelpers(res) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(obj));
        return res;
    };
    res.send = (data) => {
        if (data === undefined || data === null) { res.end(); return res; }
        if (Buffer.isBuffer(data)) { res.end(data); return res; }
        if (typeof data === 'object') return res.json(data);
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(String(data));
        return res;
    };
    res.redirect = (a, b) => {
        const [code, loc] = typeof a === 'number' ? [a, b] : [307, a];
        res.statusCode = code; res.setHeader('Location', loc); res.end();
        return res;
    };
}

async function handleApi(req, res, url) {
    const name = url.pathname.slice('/api/'.length).replace(/\/+$/, '');
    // Files starting with "_" are shared helpers, not routes (same as Vercel).
    if (!/^[a-z0-9-]+$/i.test(name) || name.startsWith('_')) return notFound(res);
    const file = path.join(API, `${name}.js`);
    if (!existsSync(file)) return notFound(res);

    // Client IP: never trust client-sent headers; only honor X-Forwarded-For from a known proxy
    // (e.g. the gateway nginx container IP, listed in TRUSTED_PROXIES).
    const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
    let clientIp = peer;
    if (TRUSTED_PROXIES.has(peer)) {
        const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
        clientIp = xff[xff.length - 1] || peer; // right-most entry = appended by the trusted proxy
    }
    // Handlers read these headers (first XFF entry), so pin all of them to the resolved IP.
    req.headers['x-vercel-forwarded-for'] = clientIp;
    req.headers['x-forwarded-for'] = clientIp;
    req.headers['x-real-ip'] = clientIp;
    req.query = Object.fromEntries(url.searchParams);
    req.cookies = parseCookies(req.headers.cookie);
    req.body = parseBody(await readBody(req), String(req.headers['content-type'] || ''));
    addResHelpers(res);

    const mod = await import(pathToFileURL(file).href);
    await mod.default(req, res);
}

async function handleStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(DIST, path.normalize(rel));
    if (!file.startsWith(DIST)) return notFound(res);
    let target = file;
    try {
        if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    } catch {
        if (!path.extname(target) && existsSync(`${target}.html`)) target = `${target}.html`;
        else return notFound(res);
    }
    try {
        const data = await readFile(target);
        res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
        res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
        notFound(res);
    }
}

function notFound(res) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
        if (url.pathname === '/healthz') return res.end('ok');
        if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
        return await handleStatic(req, res, url);
    } catch (err) {
        console.error(`[${req.method} ${url.pathname}]`, err);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'server_error', message: String(err) }));
        } else {
            res.end();
        }
    }
}).listen(PORT, () => console.log(`viewer listening on :${PORT}`));
