// Gates for docs/spec/sf-daily/api/daily-plan.md — see GATES.md in this folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseEnv } from '../../../lib/env.js';
import { fn } from '../../../lib/sut.js';
import { callInChild } from '../../../lib/child.js';
import { clearDedicated, closeDb } from '../../../lib/db.js';
import { CODES } from '../../../lib/roster.js';
import { kstAt, addDays } from '../../../lib/kst.js';

applyBaseEnv();
before(async () => { await clearDedicated(); });
after(async () => { await closeDb(); });

const DATES = ['2029-01-01', '2029-02-28', '2029-07-15', '2029-12-31'];

test('ADP-01 CO-01 돌려받는 값: date 는 요청한 그날, companies 는 명부 순서의 다섯 업체, 세 시각은 초 단위 Date', async () => {
    const getDailyPlan = await fn('daily-plan', 'getDailyPlan');
    for (const date of DATES) {
        const p = await getDailyPlan(date);
        assert.equal(p.date, date);
        assert.ok(Array.isArray(p.companies));
        assert.deepEqual(p.companies.map((c) => c.code), CODES);
        for (const c of p.companies) {
            for (const k of ['login', 'query', 'logout']) {
                assert.ok(c[k] instanceof Date && !Number.isNaN(c[k].getTime()), `${date} ${c.code}.${k} is a Date`);
                assert.equal(c[k].getTime() % 1000, 0, `${date} ${c.code}.${k} has whole seconds`);
            }
        }
    }
});

test('ADP-02 시각은 모두 그날 KST 날짜 안에 있고 login < query < logout 이다', async () => {
    const getDailyPlan = await fn('daily-plan', 'getDailyPlan');
    for (const date of DATES) {
        const p = await getDailyPlan(date);
        const lo = +kstAt(date, '00:00');
        const hi = +kstAt(addDays(date, 1), '00:00');
        for (const c of p.companies) {
            for (const k of ['login', 'query', 'logout']) assert.ok(+c[k] >= lo && +c[k] < hi, `${date} ${c.code}.${k}`);
            assert.ok(+c.login < +c.query && +c.query < +c.logout, `${date} ${c.code} order`);
        }
    }
});

test('ADP-03 date 가 YYYY-MM-DD 가 아니거나 없는 날짜면 TypeError 로 거부한다', async () => {
    const getDailyPlan = await fn('daily-plan', 'getDailyPlan');
    for (const bad of ['2029-02-30', '2029-13-01', '2029-00-10', '20290101', '2029-1-1', '', undefined, null, 20290101, new Date()]) {
        await assert.rejects(async () => getDailyPlan(bad), TypeError, `input ${String(bad)}`);
    }
});

test('ADP-04 전용 DB 에 닿지 못하면 TypeError 가 아닌 Error 로 거부한다', { timeout: 60_000 }, async () => {
    const r = await callInChild('daily-plan', 'getDailyPlan', ['2029-03-05'], { env: { SF_DB_URL: 'postgres://postgres:wrong@127.0.0.1:1/sfdaily' } });
    assert.equal(r.ok, false, 'rejected');
    assert.equal(r.error.isError, true, `rejection is an Error: ${JSON.stringify(r.error)}`);
    assert.equal(r.error.isTypeError, false, 'not the caller-defect TypeError');
});

test('ADP-05 지난 날짜도 정한 적이 없으면 새로 정하고, 그 뒤로는 그 계획을 돌려준다', async () => {
    const getDailyPlan = await fn('daily-plan', 'getDailyPlan');
    const a = await getDailyPlan('2019-06-03');
    const b = await getDailyPlan('2019-06-03');
    assert.deepEqual(a.companies.map((c) => [c.code, +c.login, +c.query, +c.logout]), b.companies.map((c) => [c.code, +c.login, +c.query, +c.logout]));
});
