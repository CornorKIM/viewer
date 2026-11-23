// JSON with Dates and errors, for crossing process boundaries.
export function enc(v) {
    if (v instanceof Date) return { $date: Number.isNaN(v.getTime()) ? null : v.toISOString() };
    if (v instanceof Error) return { $error: { name: v.name, message: String(v.message) } };
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
    return v;
}
export function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
        if ('$date' in v) return new Date(v.$date ?? NaN);
        if ('$error' in v) return v;
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]));
    }
    return v;
}
