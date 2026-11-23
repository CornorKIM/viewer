// Gates for docs/spec/sf-daily/spec/companies.md — see GATES.md in this folder.
// The roster has no surface of its own; it is judged where its consumers put its values:
// the log API request (step-sender), the history rows, the daily plan and the service start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../lib/sut.js';
import { useSendingWorld, req, seedPrevious } from '../../lib/sending.js';
import { resetHistory, clearDedicated, allHistoryRows } from '../../lib/db.js';
import { keyOf } from '../../lib/env.js';
import { ROSTER } from '../../lib/roster.js';

const world = useSendingWorld();
const sendStep = () => fn('step-sender', 'sendStep');
const fieldsFor = (sysUser) => world.fake.log.requests.filter((q) => q.fields?.sysUser === sysUser).map((q) => q.fields);

/** Sends login, then query, then logout for each code; history is cleared between steps. */
async function threeSteps(codes) {
    const send = await sendStep();
    const seen = [];
    for (const step of ['login', 'query', 'logout']) {
        await resetHistory();
        await clearDedicated();
        world.fake.reset();
        for (const code of codes) {
            await seedPrevious(code, step);
            const r = await send(req(code, step));
            assert.equal(r.outcome, 'stored', `${code} ${step}`);
        }
        seen.push(...world.fake.log.requests.map((q) => ({ step, ...q.fields })));
    }
    return seen;
}

test('CO-02 업체마다 시스템 사용자 값은 업체 표의 값이다', async () => {
    const send = await sendStep();
    for (const c of ROSTER) {
        const r = await send(req(c.code, 'login'));
        assert.equal(r.outcome, 'stored', c.code);
    }
    assert.deepEqual(world.fake.log.requests.map((q) => q.fields.sysUser), ROSTER.map((c) => c.sysUser));
});

test('CO-03 시스템 사용자 값은 세 단계 모두 같다', { timeout: 60_000 }, async () => {
    const seen = await threeSteps(ROSTER.map((c) => c.code));
    for (const c of ROSTER) {
        const mine = seen.filter((f) => f.crtfcKey === keyOf(c.code));
        assert.deepEqual(mine.map((f) => f.step), ['login', 'query', 'logout'], c.code);
        assert.deepEqual([...new Set(mine.map((f) => f.sysUser))], [c.sysUser], c.code);
    }
});

test('CO-04 업체마다 인증키는 업체 표의 「인증키 설정」 이 가리키는 설정 값이다', async () => {
    const send = await sendStep();
    for (const c of ROSTER) await send(req(c.code, 'login'));
    for (const c of ROSTER) {
        const f = fieldsFor(c.sysUser);
        assert.equal(f.length, 1, c.code);
        assert.equal(f[0].crtfcKey, process.env[c.keyEnv], `${c.code} uses ${c.keyEnv}`);
    }
});

test('CO-05 IH-03 유형2-3 업체의 이력 행 장비 번호는 업체 표의 장비 번호다', async () => {
    const send = await sendStep();
    for (const c of ROSTER) await send(req(c.code, 'login'));
    const { tp23 } = await allHistoryRows();
    for (const c of ROSTER.filter((x) => x.equipmentNo)) {
        const rows = tp23.filter((r) => r.set_code === c.code);
        assert.equal(rows.length, 1, c.code);
        assert.equal(rows[0].equipment_no, c.equipmentNo, c.code);
    }
});

test('CO-06 이력 갈래: 유형2-3 은 tp23 에 업체 코드로, 유형1 은 tp1 에 회사 코드로 남는다', async () => {
    const send = await sendStep();
    for (const c of ROSTER) await send(req(c.code, 'login'));
    const { tp23, tp1 } = await allHistoryRows();
    assert.deepEqual(tp23.map((r) => r.set_code).sort(), ['A', 'B', 'C', 'D']);
    assert.deepEqual(tp1.map((r) => r.company_code), ['CDR']);
});

test('CO-07 단계와 사용 구분 코드: 로그인 DO6001 · 조회 DO6003 · 로그아웃 DO6002', { timeout: 60_000 }, async () => {
    const seen = await threeSteps(['A', 'CDR']);
    const codes = Object.fromEntries(['login', 'query', 'logout'].map((s) => [s, [...new Set(seen.filter((f) => f.step === s).map((f) => f.useSe))]]));
    assert.deepEqual(codes, { login: ['DO6001'], query: ['DO6003'], logout: ['DO6002'] });
});

test('CO-08 데이터 등록(DO6004)은 단계가 아니다 — 그런 단계 요청은 거부되고 아무것도 나가지 않는다', async () => {
    const send = await sendStep();
    for (const step of ['register', 'DO6004', 'data']) {
        await assert.rejects(async () => send(req('A', step)), TypeError, step);
    }
    assert.equal(world.fake.log.requests.length, 0);
});
