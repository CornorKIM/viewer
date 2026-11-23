// Just enough RFC 5322 / MIME to read what the implementation handed the SMTP stub:
// header unfolding, RFC 2047 encoded words, multipart, base64 / quoted-printable / 7bit / 8bit.

function decodeBytes(buf, charset = 'utf-8') {
    try { return new TextDecoder(charset.toLowerCase()).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

function qpBytes(s, underscoreSpace) {
    const out = [];
    const src = underscoreSpace ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { out.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; } else out.push(src.charCodeAt(i) & 0xff);
    }
    return Buffer.from(out);
}

/** RFC 2047: =?charset?B|Q?text?= ; whitespace between adjacent encoded words is dropped. */
export function decodeWords(s) {
    const joined = s.replace(/(\?=)\s+(=\?)/g, '$1$2');
    return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
        const bytes = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : qpBytes(txt, true);
        return decodeBytes(bytes, cs);
    });
}

function splitHeadBody(latin1) {
    const i = latin1.search(/\r?\n\r?\n/);
    if (i < 0) return [latin1, ''];
    const m = latin1.slice(i).match(/^\r?\n\r?\n/)[0];
    return [latin1.slice(0, i), latin1.slice(i + m.length)];
}

function parseHeaders(headLatin1) {
    const unfolded = headLatin1.replace(/\r?\n[ \t]+/g, ' ');
    const headers = {};
    for (const line of unfolded.split(/\r?\n/)) {
        const j = line.indexOf(':');
        if (j <= 0) continue;
        const name = line.slice(0, j).trim().toLowerCase();
        // Raw header bytes may be UTF-8 (SMTPUTF8); then decode encoded words.
        const value = decodeWords(decodeBytes(Buffer.from(line.slice(j + 1).trim(), 'latin1')));
        (headers[name] ||= []).push(value);
    }
    return headers;
}

function param(value, name) {
    const m = (value || '').match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i'));
    return m ? (m[2] ?? m[1]) : null;
}

function parseEntity(latin1) {
    const [head, body] = splitHeadBody(latin1);
    const headers = parseHeaders(head);
    const ctype = (headers['content-type'] || ['text/plain; charset=us-ascii'])[0];
    const type = ctype.split(';')[0].trim().toLowerCase();
    if (type.startsWith('multipart/')) {
        const boundary = param(ctype, 'boundary');
        const parts = [];
        if (boundary) {
            const chunks = body.split(`--${boundary}`);
            for (const c of chunks.slice(1)) {
                if (c.startsWith('--')) break;
                parts.push(...parseEntity(c.replace(/^\r?\n/, '')).leaves);
            }
        }
        return { headers, type, leaves: parts };
    }
    const cte = ((headers['content-transfer-encoding'] || ['7bit'])[0]).trim().toLowerCase();
    let bytes;
    if (cte === 'base64') bytes = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    else if (cte === 'quoted-printable') bytes = qpBytes(body, false);
    else bytes = Buffer.from(body, 'latin1');
    const charset = param(ctype, 'charset') || 'us-ascii';
    return { headers, type, leaves: [{ type, charset: charset.toLowerCase(), contentType: ctype, text: decodeBytes(bytes, charset === 'us-ascii' ? 'utf-8' : charset), headers }] };
}

/** raw: Buffer of the DATA section as received. */
export function parseMessage(raw) {
    const latin1 = Buffer.isBuffer(raw) ? raw.toString('latin1') : Buffer.from(raw, 'utf8').toString('latin1');
    const top = parseEntity(latin1);
    const html = top.leaves.filter((l) => l.type === 'text/html');
    return {
        headers: top.headers,
        subject: (top.headers.subject || [''])[0],
        from: (top.headers.from || [''])[0],
        parts: top.leaves,
        htmlParts: html,
        html: html.map((p) => p.text).join('\n'),
        rawText: decodeBytes(Buffer.from(latin1, 'latin1')),
    };
}
