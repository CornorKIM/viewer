// Loads the system under test (sf-daily/<module>.js) by the test-binding convention.
// A missing module or export fails the calling test with a message starting "SUT_MISSING".
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SUT_DIR } from './paths.js';

export function sutFile(mod) { return path.join(SUT_DIR, `${mod}.js`); }

export function assertSut(mod) {
    if (!existsSync(sutFile(mod))) throw new Error(`SUT_MISSING: sf-daily/${mod}.js 가 없다`);
}

export async function load(mod) {
    assertSut(mod);
    return import(pathToFileURL(sutFile(mod)).href);
}

export async function fn(mod, name) {
    const m = await load(mod);
    if (typeof m[name] !== 'function') throw new Error(`SUT_MISSING: sf-daily/${mod}.js 가 ${name} 을 내보내지 않는다`);
    return m[name];
}
