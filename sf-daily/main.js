// sf-daily service entry: `node sf-daily/main.js`.
// Checks the settings (refuses to start naming every bad one), then runs one round every SF_DAILY_TICK_SECONDS.
import { checkSettings } from './settings.js';
import { createRunner } from './runner.js';
import { now } from './clock.js';
import { judgeBusinessDay } from './business-day.js';
import { getDailyPlan } from './daily-plan.js';
import { sendStep } from './step-sender.js';
import { sendStatusMail } from './status-mail.js';

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
});

let stopping = false;
let timer = null;
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
        stopping = true;
        if (timer) clearTimeout(timer);
        console.log(`[sf-daily] ${sig} — 멈춘다`);
        process.exit(0);
    });
}

const periodMs = tickSeconds * 1000;
async function loop(startedAt) {
    if (stopping) return;
    try {
        await runner.tick();
    } catch (err) {
        console.error(`[sf-daily] 회차 오류: ${String(err?.message ?? err)}`);
    }
    // Rounds start every periodMs regardless of how long a round took.
    let next = startedAt + periodMs;
    while (next <= Date.now()) next += periodMs;
    timer = setTimeout(() => loop(next), next - Date.now());
}
loop(Date.now());
