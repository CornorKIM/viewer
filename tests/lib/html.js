// Reading the status-mail HTML the way a person sees it: visible text, table rows, red marking.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENT[e.toLowerCase()] ?? m;
    });
}

export function stripTags(html) {
    return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[ \t ]+/g, ' ').trim();
}

/** The <body> (or whole document) without head, style, script and comments. */
export function bodyMarkup(html) {
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return (m ? m[1] : html)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** Visible text of the body, whitespace-collapsed. */
export function visibleText(html) { return stripTags(bodyMarkup(html)).replace(/\s+/g, ' ').trim(); }

/** Visible text that precedes the first <table> of the body. */
export function textBeforeTable(html) {
    const b = bodyMarkup(html);
    const i = b.search(/<table\b/i);
    return stripTags(i < 0 ? b : b.slice(0, i)).replace(/\s+/g, ' ').trim();
}

/** Every <tr> of the body: { markup, cells: [cell text…], text }. */
export function tableRows(html) {
    const b = bodyMarkup(html);
    const rows = [];
    for (const m of b.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
        const markup = m[0];
        const cells = [...markup.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]).replace(/\s+/g, ' ').trim());
        rows.push({ markup, cells, text: cells.join(' | ') });
    }
    return rows;
}

// ── red detection ────────────────────────────────────────────────────────────
const NAMED = { red: [255, 0, 0], darkred: [139, 0, 0], crimson: [220, 20, 60], firebrick: [178, 34, 34], indianred: [205, 92, 92], tomato: [255, 99, 71], orangered: [255, 69, 0], maroon: [128, 0, 0], salmon: [250, 128, 114], lightcoral: [240, 128, 128], mistyrose: [255, 228, 225], pink: [255, 192, 203] };

function rgbOf(v) {
    const s = v.trim().toLowerCase();
    let m;
    if ((m = s.match(/^#([0-9a-f]{3})$/))) return [...m[1]].map((h) => parseInt(h + h, 16));
    if ((m = s.match(/^#([0-9a-f]{6})/))) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    if ((m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/))) return [+m[1], +m[2], +m[3]];
    return NAMED[s] || null;
}

/** Red hue (±25°), clearly saturated, not near-white/near-black. */
export function isRed(value) {
    const rgb = rgbOf(value);
    if (!rgb) return false;
    const [r, g, b] = rgb.map((x) => x / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return false;
    const d = max - min;
    const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return (h <= 25 || h >= 335) && sat >= 0.4 && l >= 0.2 && l <= 0.92;
}

const COLOR_PROPS = /(?:^|;|\s)(color|background|background-color|border|border-color|border-left|border-left-color)\s*:\s*([^;]+)/gi;

function declsRed(decls) {
    for (const m of decls.matchAll(COLOR_PROPS)) {
        for (const tok of m[2].split(/\s+(?![^(]*\))/)) if (isRed(tok)) return true;
    }
    return false;
}

/** Class names whose <style> rules paint something red. */
export function redClasses(html) {
    const set = new Set();
    for (const st of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        for (const rule of st[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
            if (!declsRed(rule[2])) continue;
            for (const c of rule[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) set.add(c[1]);
        }
    }
    return set;
}

/** Does this markup (a row with its cells) carry a red color — inline style, color attr or red class? */
export function markupIsRed(markup, classes = new Set()) {
    for (const m of markup.matchAll(/style\s*=\s*("([^"]*)"|'([^']*)')/gi)) if (declsRed(m[2] ?? m[3])) return true;
    for (const m of markup.matchAll(/(?:color|bgcolor)\s*=\s*["']?([#\w(),\s]+?)["'\s>]/gi)) if (isRed(m[1])) return true;
    for (const m of markup.matchAll(/class\s*=\s*["']([^"']*)["']/gi)) for (const c of m[1].split(/\s+/)) if (classes.has(c)) return true;
    return false;
}
