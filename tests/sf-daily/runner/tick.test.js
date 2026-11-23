// Gates for docs/spec/sf-daily/spec/runner.md judged round by round through createRunner(deps)
// with a fake clock and fake seams (tests/sf-daily/runner/world.js). See GATES.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRunner, planFor, PLAN, weekendJudge, kstAt } from './world.js';
import { addDays, kstDate } from '../../lib/kst.js';
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

test('RN-17 판단이 확인 불가면 그 회차에 단계 보내기 요청이 없다', async () => {
    const unknown = () => ({ date: D, result: 'unknown', reason: 'calendar_fetch_failed', holidayName: null });
    const w = await makeRunner({ judge: unknown });
    await w.run(T('10:30:30'), T('11:59:30')); // CDR · A · B · C · D logins come due in these rounds
    assert.ok(w.calls.some((c) => c.kind === 'judge'), 'the runner judged');
    assert.equal(w.steps().length, 0);
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

const judges = (w, from = -Infinity, to = Infinity) => w.calls.filter((c) => c.kind === 'judge' && c.now >= +from && c.now <= +to);
const offJudgment = (date) => ({ date, result: 'off', reason: 'holiday', holidayName: '임시공휴일' });
const unknownJudgment = (date) => ({ date, result: 'unknown', reason: 'calendar_fetch_failed', holidayName: null });

test('RN-33 그날 아직 판단을 받은 적이 없으면 그날 첫 회차에 판단을 받는다 — 요청할 것이 없어도', async () => {
    const w = await makeRunner();
    await w.at(T('03:00:00')); // nothing is due at 03:00
    assert.equal(judges(w).length, 1, 'judged in the first round of the day');
    const next = addDays(D, 1);
    await w.at(T('00:00:30', next));
    assert.equal(judges(w, T('00:00:00', next)).length, 1, 'judged again in the first round of the next day');
    // an off day does not carry over either
    const sat = await makeRunner();
    await sat.at(T('03:00:00', SAT));
    await sat.at(T('03:00:00', addDays(SAT, 1)));
    assert.equal(judges(sat).length, 2, 'Saturday and Sunday are each judged once in their first round');
});

test('RN-34 영업일 판단 뒤 요청할 단계도 메일도 없는 회차에는 판단을 받지 않는다', async () => {
    const w = await makeRunner();
    await w.run(T('03:00:00'), T('10:09:30')); // first step due: CDR login 10:10
    assert.equal(judges(w).length, 1, 'only the first round judged before any step was due');
    await w.run(T('10:10:00'), T('13:00:00')); // every login and query is stored by 13:00
    await w.run(T('13:00:30'), T('17:29:30')); // next due: CDR logout 17:30
    assert.equal(judges(w, T('13:00:30'), T('17:29:30')).length, 0, 'no judgment while nothing was due');
});

test('RN-35 확인 불가가 이어지면 그 판단에서 10분이 지난 첫 회차에 다시 받고, 그 전에는 받지 않는다', async () => {
    const w = await makeRunner({ judge: (at) => unknownJudgment(D) });
    await w.run(T('09:00:00'), T('11:00:00'));
    const at = judges(w).map((c) => c.now);
    assert.ok(at.length >= 3, `judgments ${at.length}`);
    for (let i = 1; i < at.length; i++) {
        const gap = (at[i] - at[i - 1]) / 1000;
        assert.ok(gap >= 600 && gap <= 630, `gap ${gap}s between judgments`);
    }
    assert.equal(w.steps().length, 0);
    // unknown until 10:35, a business day afterwards: next judgment and the due steps come at 10:40:30
    const until = +T('10:35:00');
    const v = await makeRunner({ judge: (t) => (+t < until ? unknownJudgment(D) : weekendJudge(t)) });
    await v.run(T('10:30:30'), T('10:45:00'));
    assert.equal(judges(v, T('10:31:00'), T('10:40:00')).length, 0, 'no judgment within 10 minutes of the unknown one');
    assert.ok(judges(v, T('10:40:30'), T('10:40:30')).length >= 1, 'judged again 10 minutes later');
    assert.equal(v.steps().filter((c) => c.now < +T('10:40:30')).length, 0, 'no step before that');
    assert.ok(v.steps({ company: 'A', step: 'login' }).some((c) => c.now === +T('10:40:30')), 'A login requested once judged business');
});

test('RN-36 그날 판단 중 쉬는 날이 한 번이라도 있었으면 그날은 판단을 다시 받지 않는다', async () => {
    const w = await makeRunner({ judge: (t) => (kstDate(t) === D ? offJudgment(D) : weekendJudge(t)) });
    await w.run(T('09:00:00'), T('23:59:30'));
    assert.equal(judges(w).length, 1, 'one judgment for the whole off day');
    await w.at(T('00:00:30', addDays(D, 1)));
    assert.equal(judges(w).length, 2, 'the next day is judged again');
    // business in the morning, off at 10:40 (B login due): no judgment for the rest of the day
    const v = await makeRunner({ judge: offBetween('10:35:00', '10:45:00') });
    await v.run(T('10:00:00'), T('23:59:30'));
    const off = v.calls.find((c) => c.kind === 'judge' && c.now >= +T('10:35:00') && c.now < +T('10:45:00'));
    assert.ok(off, 'precondition: the runner judged during the off window');
    assert.equal(judges(v, off.now + 1).length, 0, 'no judgment after the off judgment that day');
});

test('RN-37 쉬는 날로 판단된 그날에는 단계도 메일도 요청하지 않는다', async () => {
    // off only between 10:35 and 10:45: a runner that asked again would hear "business"
    const v = await makeRunner({ judge: offBetween('10:35:00', '10:45:00') });
    await v.run(T('10:00:00'), T('23:59:30'));
    const off = v.calls.find((c) => c.kind === 'judge' && c.now >= +T('10:35:00') && c.now < +T('10:45:00'));
    assert.ok(off, 'precondition: the runner judged during the off window');
    assert.ok(v.steps().some((c) => c.now < off.now), 'precondition: steps were sent before the off judgment');
    assert.deepEqual(v.calls.filter((c) => (c.kind === 'step' || c.kind === 'mail') && c.now >= off.now).map((c) => `${c.kind} ${c.company ?? ''} ${c.step ?? ''}`), []);
    const next = addDays(D, 1);
    await v.run(T('10:00:00', next), T('10:31:00', next));
    assert.ok(v.steps({ company: 'A', step: 'login' }).some((c) => c.date === next), 'steps resume the next day');
});

function offBetween(from, to) {
    return (t) => (kstDate(t) === D && +t >= +T(from) && +t < +T(to) ? offJudgment(D) : weekendJudge(t));
}
