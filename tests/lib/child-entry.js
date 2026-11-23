// Child process body for child.js: imports one sf-daily module, calls one export, prints the result.
import { fn } from './sut.js';
import { enc, dec } from './wire.js';

const { mod, name, args } = JSON.parse(process.env.GATE_CHILD_CALL);
let out;
try {
    const f = await fn(mod, name);
    try {
        out = { ok: true, value: enc(await f(...dec(args))) };
    } catch (err) {
        out = { ok: false, error: { name: err?.name, message: String(err?.message ?? err), isTypeError: err instanceof TypeError, isError: err instanceof Error } };
    }
} catch (err) {
    out = { ok: false, loadFailed: true, error: { name: err?.name, message: String(err?.message ?? err) } };
}
process.stdout.write(`\n__GATE_RESULT__${JSON.stringify(out)}\n`);
process.exit(0);
