// Preloaded into a spawned sf-daily process (node --import) to move its wall clock without any
// sf-daily setting: GATE_FAKE_NOW=<ISO instant> → Date.now() / new Date() start at that instant and
// advance GATE_FAKE_RATE (default 1) times as fast as real time. Timers (setTimeout, setInterval)
// keep real speed; only Date moves. Used by child.js startService({ fakeNow, fakeRate }).
const RealDate = globalThis.Date;
const target = RealDate.parse(process.env.GATE_FAKE_NOW ?? '');
const rate = Number(process.env.GATE_FAKE_RATE || 1);

if (!Number.isNaN(target) && rate > 0) {
    const realStart = RealDate.now();
    const fakeNow = () => Math.floor(target + (RealDate.now() - realStart) * rate);
    class FakeDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) super(fakeNow()); else super(...args);
        }
        static now() { return fakeNow(); }
        static [Symbol.hasInstance](x) { return x instanceof RealDate; }
    }
    // Date() called without new returns the current time as a string.
    globalThis.Date = new Proxy(FakeDate, { apply: () => new FakeDate().toString() });
}
