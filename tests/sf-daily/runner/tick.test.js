// Gates for docs/spec/sf-daily/spec/runner.md judged round by round through createRunner(deps)
// with a fake clock and fake seams (tests/sf-daily/runner/world.js). See GATES.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRunner, planFor, PLAN, weekendJudge, kstAt } from './world.js';
import { addDays } from '../../lib/kst.js';
import { CODES, byCode, WINDOWS } from '../../lib/roster.js';

const D = '2026-11-24'; // Tuesday
const SAT = '2026-11-28';
const T = (hms, date = D) => kstAt(date, hms);
const ticksWithSteps = (w) => [...new Set(w.steps().map((c) => c.tick))];

test('RN-15 단계 보내기를 요청하기 직전마다 같은 회차 안에서 영업일 판단을 새로 받는다', async () => {
    const w = await makeRunner();
    await w.run(T('10:00:00'), T('13:30:00'));
    const stepTicks = ticksWithSteps(w);
    assert.ok(stepTicks.length >= 3, 'steps were requested in several rounds');
    for (const c of w.steps()) {
        const before = w.calls.slice(0, w.calls.indexOf(c));
        assert.ok(before.some((x) => x.kind === 'judge' && x.tick === c.tick), `round ${c.tick}: no judgment before ${c.company} ${c.step}`);
    }
});

test('RN-16 판단이 쉬는 날이면 그 회차에 단계 보내기 요청이 없다', async () => {
    const holiday = (at) => ({ date: D, result: 'off', reason: 'holiday', holidayName: '임시공휴일' });
    const w = await makeRunner({ judge: holiday });
    await w.run(T('09:00:00'), T('23:30:00'), 60);
    assert.ok(w.calls.some((c) => c.kind === 'judge'), 'the runner judged');
    assert.equal(w.steps().length, 0);
    const sat = await makeRunner();
    await sat.run(T('09:00:00', SAT), T('23:30:00', SAT), 60);
    assert.equal(sat.steps().length, 0);
});

test('RN-17 판단이 확인 불가면 그 회차에 단계 보내기 요청이 없고 다음 회차에 다시 판단한다', async () => {
    const unknownAt = +T('10:30:30');
    const judge = (at) => (+at >= unknownAt && +at < unknownAt + 30_000
        ? { date: D, result: 'unknown', reason: 'calendar_fetch_failed', holidayName: null }
        : weekendJudge(at));
    const w = await makeRunner({ judge });
    await w.at(T('10:30:00'));
    await w.at(T('10:30:30'));
    const unknownTick = w.tick;
    await w.at(T('10:31:00'));
    assert.equal(w.inTick(unknownTick).filter((c) => c.kind === 'step').length, 0, 'no step in the unknown round');
    const next = w.inTick(unknownTick + 1);
    assert.ok(next.some((c) => c.kind === 'judge'), 'judged again next round');
    assert.ok(next.some((c) => c.kind === 'step' && c.company === 'A' && c.step === 'login'), 'A login (due 10:30:10) requested next round');
});

test('RN-18 현황 메일을 요청하기 직전에도 영업일 판단을 새로 받고, 영업일이 아니면 메일을 요청하지 않는다', async () => {
    const w = await makeRunner({ mail: () => 'failed' });
    await w.run(T('22:59:00'), T('23:30:00'));
    assert.ok(w.mails().length >= 1);
    for (const m of w.mails()) {
        const before = w.calls.slice(0, w.calls.indexOf(m));
        assert.ok(before.some((x) => x.kind === 'judge' && x.tick === m.tick), `round ${m.tick}: no judgment before the mail`);
    }
    const off = await makeRunner({ judge: () => ({ date: D, result: 'off', reason: 'holiday', holidayName: 'x' }) });
    await off.run(T('22:59:00'), T('23:59:30'));
    assert.equal(off.mails().length, 0);
    const unknown = await makeRunner({ judge: () => ({ date: D, result: 'unknown', reason: 'year_missing', holidayName: null }) });
    await unknown.run(T('22:59:00'), T('23:59:30'));
    assert.equal(unknown.mails().length, 0);
    const sat = await makeRunner();
    await sat.run(T('22:59:00', SAT), T('23:59:30', SAT));
    assert.equal(sat.mails().length, 0);
});

test('RN-19 영업일에 처음 깨어난 회차에 그날 하루 계획을 받는다', async () => {
    const w = await makeRunner();
    await w.at(T('09:00:00'));
    assert.ok(w.inTick(1).some((c) => c.kind === 'plan' && c.date === D), 'getDailyPlan(today) in the first round');
});

test('RN-20 단계 보내기는 그 단계의 계획 시각 이후에만 요청한다', async () => {
    const w = await makeRunner();
    await w.run(T('09:00:00'), T('20:30:00'));
    for (const c of w.steps()) {
        const p = planFor(D).companies.find((x) => x.code === c.company);
        assert.ok(c.now >= +p[c.step], `${c.company} ${c.step} requested at ${new Date(c.now).toISOString()} before its plan ${p[c.step].toISOString()}`);
    }
    const aLogin = w.steps({ company: 'A', step: 'login' });
    assert.equal(aLogin[0]?.now, +T('10:30:30'), 'A login (plan 10:30:10) requested in the first round after it');
});

test('RN-21 보내는 범위의 끝: 로그인은 유형의 로그인 범위 끝 · 조회는 로그인 계획 + 3시간 · 로그아웃은 유형의 로그아웃 범위 끝', async () => {
    const w = await makeRunner();
    await w.run(T('09:00:00'), T('22:30:00'));
    for (const code of CODES) {
        const w2 = WINDOWS[byCode(code).type];
        const expect = {
            login: +T(`${w2.login[1]}:00`),
            query: +T(PLAN[code][0]) + 3 * 3600_000,
            logout: +T(`${w2.logout[1]}:00`),
        };
        for (const step of ['login', 'query', 'logout']) {
            const c = w.steps({ company: code, step });
            assert.ok(c.length >= 1, `${code} ${step} requested`);
            for (const x of c) {
                assert.equal(+x.windowEnd, expect[step], `${code} ${step} windowEnd`);
                assert.equal(x.date, D, `${code} ${step} date`);
            }
        }
    }
});

test('RN-22 결과가 정상 저장 · 이미 저장됨 · 지난 날 · 범위 지남이면 그날 그 단계는 다시 요청하지 않는다', async () => {
    for (const outcome of ['stored', 'already_stored', 'past_day', 'window_passed']) {
        const w = await makeRunner({ step: (r) => (r.company === 'A' && r.step === 'login' ? outcome : 'stored') });
        await w.run(T('10:00:00'), T('12:30:00'));
        assert.equal(w.steps({ company: 'A', step: 'login' }).length, 1, `${outcome}: A login requested once`);
    }
});

test('RN-23 결과가 오류 응답 · 전송 실패 · 10분 대기 · 이미 진행 중 · 앞 단계 없음이면 범위 끝 전까지 다음 회차마다 다시 요청한다', async () => {
    // A's query is planned after the login window so only the login competes for A's rounds.
    // Rounds fall on :15 / :45 so no round lands exactly on a plan time or a window end.
    const times = { ...PLAN, A: ['10:30:10', '12:10:00', '18:00:00'] };
    const every = (from, to) => { const out = []; for (let t = +T(from); t <= +T(to); t += 30_000) out.push(t); return out; };
    for (const outcome of ['error_response', 'send_failed', 'wait_10min', 'in_progress', 'previous_missing']) {
        const w = await makeRunner({ plan: (date) => planFor(date, times), step: (r) => (r.company === 'A' && r.step === 'login' ? outcome : 'stored') });
        await w.run(T('10:30:15'), T('12:05:15'));
        const ticks = w.steps({ company: 'A', step: 'login' }).map((c) => c.now);
        assert.deepEqual(ticks, every('10:30:15', '11:59:45'), `${outcome}: every round from the plan time until the window end (12:00), none after`);
    }
    // previous_missing on a query: retried every round until login plan + 3 h (13:30:10)
    const w = await makeRunner({ plan: (date) => planFor(date, times), step: (r) => (r.company === 'A' && r.step === 'query' ? 'previous_missing' : 'stored') });
    await w.run(T('12:00:15'), T('14:00:15'));
    const q = w.steps({ company: 'A', step: 'query' }).map((c) => c.now);
    assert.deepEqual(q, every('12:10:15', '13:29:45'));
});

test('RN-24 같은 업체에 대해 한 회차에 요청하는 단계는 하나다', async () => {
    const times = { ...PLAN, A: ['10:00:10', '10:30:20', '17:00:30'] };
    const w = await makeRunner({ plan: (date) => planFor(date, times) });
    await w.run(T('10:45:00'), T('11:30:00')); // late start: A's login and query are both due in the first round
    await w.run(T('17:01:00'), T('17:05:00'));
    const perTick = {};
    for (const c of w.steps()) {
        const k = `${c.tick}/${c.company}`;
        perTick[k] = (perTick[k] || 0) + 1;
    }
    for (const [k, n] of Object.entries(perTick)) assert.equal(n, 1, `round/company ${k} has ${n} requests`);
    assert.equal(w.steps({ company: 'A', step: 'login' }).length, 1);
    assert.equal(w.steps({ company: 'A', step: 'query' }).length, 1);
});

test('RN-25 서비스가 계획 시각 뒤에 시작돼도 범위 끝 전인 단계는 시작 뒤 첫 회차에 요청한다', async () => {
    const w = await makeRunner();
    await w.at(T('11:05:00'));
    const first = w.inTick(1).filter((c) => c.kind === 'step');
    for (const code of ['A', 'B', 'C', 'D']) assert.ok(first.some((c) => c.company === code), `${code} requested in the first round`);
});

test('RN-26 범위 끝이 지난 단계는 요청하지 않는다', async () => {
    const w = await makeRunner();
    await w.run(T('12:30:00'), T('13:00:00'));
    assert.equal(w.steps({ step: 'login' }).length, 0, 'no login after every login window ended');
    const late = await makeRunner();
    await late.run(T('22:00:30'), T('22:30:00'));
    assert.equal(late.steps().length, 0, 'nothing after every window ended');
});

test('RN-27 영업일에 KST 시각이 SF_REPORT_AT 이상이면 그날 현황 메일을 요청한다', async () => {
    const w = await makeRunner({ env: { SF_REPORT_AT: '22:00' } });
    await w.run(T('21:58:00'), T('22:00:00'));
    assert.deepEqual(w.mails().map((m) => [m.now, m.date]), [[+T('22:00:00'), D]]);
});

test('RN-28 SF_REPORT_AT 이 없으면 23:00 이다', async () => {
    const w = await makeRunner();
    await w.run(T('22:58:00'), T('23:00:00'));
    assert.deepEqual(w.mails().map((m) => [m.now, m.date]), [[+T('23:00:00'), D]]);
});

test('RN-29 메일 결과가 실패면 그날 안에 5분 이상 간격으로 다음 회차에 다시 요청한다', async () => {
    const w = await makeRunner({ mail: () => 'failed' });
    await w.run(T('23:00:00'), T('23:30:00'));
    const at = w.mails().map((m) => m.now);
    assert.ok(at.length >= 4, `requests ${at.length}`);
    for (let i = 1; i < at.length; i++) {
        const gap = (at[i] - at[i - 1]) / 1000;
        assert.ok(gap >= 300 && gap <= 330, `gap ${gap}s`);
    }
});

test('RN-30 메일 결과가 보냄 · 이미 보냄이면 그날 다시 요청하지 않는다', async () => {
    for (const outcome of ['sent', 'already_sent']) {
        const w = await makeRunner({ mail: () => outcome });
        await w.run(T('23:00:00'), T('23:59:30'));
        assert.equal(w.mails().length, 1, outcome);
    }
});

test('RN-31 그날이 지나면 지난 날의 현황 메일을 요청하지 않는다', async () => {
    const w = await makeRunner({ env: { SF_REPORT_AT: '23:58' }, mail: () => 'failed' });
    await w.run(T('23:58:00'), T('00:40:00', addDays(D, 1)));
    assert.ok(w.mails().length >= 1, 'the day\'s mail was tried');
    const midnight = +T('00:00:00', addDays(D, 1));
    assert.deepEqual(w.mails().filter((m) => m.now >= midnight), [], 'no mail request after midnight');
});

test('RN-32 보내기 결과와 메일 결과마다 실행 기록이 한 줄씩 나온다', async () => {
    const w = await makeRunner();
    await w.run(T('10:00:00'), T('11:30:00'));
    await w.run(T('23:00:00'), T('23:01:00'));
    const results = w.calls.filter((c) => c.kind === 'step' || c.kind === 'mail');
    assert.ok(results.length >= 5);
    for (const t of new Set(results.map((c) => c.tick))) {
        const n = results.filter((c) => c.tick === t).length;
        const lines = w.logs.filter((l) => l.tick === t).length;
        assert.ok(lines >= n, `round ${t}: ${n} results, ${lines} log lines`);
    }
});
