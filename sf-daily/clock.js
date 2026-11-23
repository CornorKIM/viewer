// The one clock all of sf-daily reads "now" from.
// SF_DAILY_FAKE_NOW=<ISO instant> → that instant + the real time elapsed since this value was first seen.
let seen = null; // { value, base, realStart }

export function now() {
    const v = process.env.SF_DAILY_FAKE_NOW;
    if (!v) return new Date();
    if (!seen || seen.value !== v) {
        const base = Date.parse(v);
        if (Number.isNaN(base)) return new Date();
        seen = { value: v, base, realStart: Date.now() };
    }
    return new Date(seen.base + (Date.now() - seen.realStart));
}
