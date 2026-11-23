// sf-daily service entry: `node sf-daily/main.js`.
// Checks the settings (refuses to start naming every bad one), then runs one round every SF_DAILY_TICK_SECONDS.
// Durations here (round cadence, stall watchdog, stop wait) use the monotonic clock, not Date.
import { performance } from 'node:perf_hooks';
import { checkSettings } from './settings.js';
import { createRunner } from './runner.js';
import { now } from './clock.js';
import { judgeBusinessDay } from './business-day.js';
import { getDailyPlan } from './daily-plan.js';
import { sendStep } from './step-sender.js';
import { sendStatusMail } from './status-mail.js';

const STALL_MS = 5 * 60_000; // runner §6: a round older than this ends the service
const STOP_WAIT_MS = 15_000; // runner §6: how long a stop signal waits for the running round

const check = checkSettings(process.env);
if (!check.ok) {
    for (const p of check.problems) console.error(`[sf-daily] 설정 오류 ${p.name}: ${p.why}`);
    console.error(`[sf-daily] 시작하지 않는다 — 고칠 설정: ${check.problems.map((p) => p.name).join(', ')}`);
    process.exit(1);
}

const { enabled, tickSeconds, reportAt } = check.settings;
console.log(`[sf-daily] 시작 — ${enabled ? '켜짐' : '꺼짐(SF_DAILY_ENABLED=false: 보내지 않음)'}, 회차 간격 ${tickSeconds}초, 현황 메일 ${reportAt}`);

const runner = createRunner({
    now,
    env: process.env,
    judgeBusinessDay,
    getDailyPlan,
    sendStep,
    sendStatusMail,
    log: (line) => console.log(line),
    stopRequested: () => stopping,
});

const mono = () => performance.now();
let stopping = false;
let timer = null;
let roundStartedAt = null; // monotonic ms of the running round, null between rounds
let roundDone = null; // resolves when the running round ends

// Stall watchdog: DB or mail server never answering must not freeze every later day.
setInterval(() => {
    if (roundStartedAt !== null && mono() - roundStartedAt >= STALL_MS) {
        console.error(`[sf-daily] 회차가 ${Math.round((mono() - roundStartedAt) / 1000)}초째 끝나지 않는다 — 끝낸다(컨테이너가 다시 띄운다)`);
        process.exit(2);
    }
}, 1000).unref();

for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
        if (stopping) return;
        stopping = true;
        if (timer) clearTimeout(timer);
        if (roundStartedAt === null) {
            console.log(`[sf-daily] ${sig} — 멈춘다`);
            process.exit(0);
        }
        console.log(`[sf-daily] ${sig} — 진행 중인 회차를 최대 ${STOP_WAIT_MS / 1000}초 기다린다`);
        const finished = await Promise.race([roundDone.then(() => true), new Promise((r) => setTimeout(() => r(false), STOP_WAIT_MS))]);
        console.log(`[sf-daily] ${finished ? '회차가 끝났다 — 멈춘다' : '회차가 끝나지 않았다 — 그대로 멈춘다'}`);
        process.exit(finished ? 0 : 1);
    });
}

const periodMs = tickSeconds * 1000;
async function loop(startedAt) {
    if (stopping) return;
    roundStartedAt = mono();
    let finish;
    roundDone = new Promise((r) => { finish = r; });
    try {
        await runner.tick();
    } catch (err) {
        console.error(`[sf-daily] 회차 오류: ${String(err?.message ?? err)}`);
    } finally {
        roundStartedAt = null;
        finish();
    }
    if (stopping) return;
    // Rounds start every periodMs regardless of how long a round took.
    let next = startedAt + periodMs;
    while (next <= mono()) next += periodMs;
    timer = setTimeout(() => loop(next), next - mono());
}
loop(mono());
