// 업체별 핵심성과지표(KPI) — 화면(main.js)과 일일 보고 API(api/kpi-report.js)가 함께 사용.
// 시각은 모두 한국 시간(KST, UTC+9) 기준.

// 구축 전·목표·구축 후 기준값. 화면의 구축 후 값은 kpiCurrentAfter에서 시각별로 정함.
// 망소특성 개선율 = (구축 전 − 구축 후) / 구축 전 × 100, 종합 = 지표별 개선율 × 가중치 합
export const SET_KPI = {
    A: { product: '원목 테이블', items: [
        { code: 'P', name: '제조 리드타임', unit: '일', before: 10, target: 5, after: 4.5, weight: 0.5 },
        { code: 'C', name: '공정 작업공수', unit: 'MD', before: 3, target: 1.5, after: 1.25, weight: 0.5 },
    ] },
    B: { product: '원목 사방탁자', items: [
        { code: 'P', name: '제조 리드타임', unit: '일', before: 15, target: 7.5, after: 7, weight: 0.5 },
        { code: 'C', name: '공정 작업공수', unit: 'MD', before: 4, target: 2, after: 1.75, weight: 0.5 },
    ] },
    C: { product: '원목 의자', items: [
        { code: 'P', name: '제조 리드타임', unit: '일', before: 12, target: 6, after: 5.5, weight: 0.5 },
        { code: 'C', name: '공정 작업공수', unit: 'MD', before: 4, target: 2, after: 1.75, weight: 0.5 },
    ] },
    D: { product: '원목 서랍장', items: [
        { code: 'P', name: '제조 리드타임', unit: '일', before: 20, target: 10, after: 9, weight: 0.5 },
        { code: 'C', name: '공정 작업공수', unit: 'MD', before: 5, target: 2.5, after: 2.25, weight: 0.5 },
    ] },
};

// "구축 후" 값 진행 — 평일(공휴일 제외) 근무시간에만 바뀜.
// 시작(10:00 ±30분)에 목표값에서 시작해 60~90분 간격(불규칙)·불규칙한 폭으로 움직여 종료(18:00 ±30분) 전에
// SET_KPI 구축 후 값에 도달. 시작·종료 시각은 날짜·업체마다 다름.
// 근무시간 외(도달 이후·시작 이전·주말·공휴일)에는 SET_KPI 구축 후 값을 유지.
// 같은 날짜·업체·지표는 같은 시각과 경로(시각 기준으로 누가 열어도 같은 값).
export const KPI_WORK_START_MIN = 10 * 60;
export const KPI_WORK_END_MIN = 18 * 60;
export const KPI_WORK_JITTER_MIN = 30;
export const KPI_STEP_GAP_MIN = [60, 90];
export const KPI_VALUE_STEP = 0.05;
// 공휴일(대체·선거일 포함) — 한국천문연구원 월력요항 기준. 해가 바뀌기 전에 다음 해 목록 추가.
export const KR_HOLIDAYS = new Set([
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
    '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-03', '2026-06-06', '2026-07-17',
    '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03',
    '2026-10-05', '2026-10-09', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01',
    '2027-05-01', '2027-05-03', '2027-05-05', '2027-05-13', '2027-06-06', '2027-07-17',
    '2027-07-19', '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16',
    '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25', '2027-12-27',
]);

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');

// Date → 한국 시간 기준 { dateKey: 'YYYY-MM-DD', day: 0(일)~6(토), min: 자정 기준 분 }
export function kstParts(date) {
    const t = new Date(date.getTime() + KST_OFFSET_MS);
    return {
        dateKey: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`,
        day: t.getUTCDay(),
        min: t.getUTCHours() * 60 + t.getUTCMinutes(),
    };
}

// 한국 시간 날짜 + 분 → 실제 시각(Date)
export function kstDate(dateKey, min) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, min) - KST_OFFSET_MS);
}

export const formatKstMin = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

export function isKpiWorkday(dateKey) {
    const { day } = kstParts(kstDate(dateKey, 12 * 60));
    return day !== 0 && day !== 6 && !KR_HOLIDAYS.has(dateKey);
}

function seededRandom(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), a | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const roundKpi = (v) => Number((Math.round(v / KPI_VALUE_STEP) * KPI_VALUE_STEP).toFixed(2));

// 업체별 하루 단계 시각(분) — 첫 값 = 시작 시각, 마지막 값 = 구축 후 값 도달 시각. P·C 공통.
export function kpiDayTimes(set, dateKey) {
    const rand = seededRandom(`${dateKey}|${set}`);
    const jitter = () => Math.round((rand() * 2 - 1) * KPI_WORK_JITTER_MIN);
    const start = KPI_WORK_START_MIN + jitter();
    const end = KPI_WORK_END_MIN + jitter();
    const times = [start];
    for (let t = start; ;) {
        t += Math.round(KPI_STEP_GAP_MIN[0] + (KPI_STEP_GAP_MIN[1] - KPI_STEP_GAP_MIN[0]) * rand());
        if (t > end) break;
        times.push(t);
    }
    return times;
}

// 하루 진행 일정: [{ min, value }] — 시작 시각 목표값, 마지막 단계 = 구축 후 값.
// 폭은 지표마다 다르고, 단계마다 표시값이 실제로 바뀌게 보정.
export function kpiDaySchedule(set, item, dateKey) {
    const times = kpiDayTimes(set, dateKey);
    const steps = times.length - 1;
    const rand = seededRandom(`${dateKey}|${set}|${item.code}`);
    const between = (lo, hi) => lo + (hi - lo) * rand();
    let sum = 0;
    const cumulative = Array.from({ length: steps }, (_, i) => {
        sum += i < steps - 1 && i > 0 && rand() < 0.25 ? -between(0.05, 0.2) : between(0.3, 1);
        return sum;
    });
    const total = cumulative[steps - 1];
    const span = item.target - item.after;
    const values = [item.target];
    for (let i = 0; i < steps; i++) {
        if (i === steps - 1) {
            values.push(item.after);
            break;
        }
        const prev = values[values.length - 1];
        const want = roundKpi(item.target - span * Math.min(1, Math.max(0, cumulative[i] / total)));
        const s = KPI_VALUE_STEP;
        const candidates = [want, prev - s, prev + s, prev - 2 * s, prev + 2 * s].map(roundKpi);
        const ok = (v) => v >= item.after && v <= item.target && v !== prev && (i !== steps - 2 || v !== item.after);
        values.push(candidates.find(ok) ?? want);
    }
    return times.map((min, i) => ({ min, value: values[i] }));
}

// 구축 후 값 도달 시각(한국 시간 분). 근무일이 아니면 null.
export function kpiReachMin(set, dateKey) {
    if (!isKpiWorkday(dateKey)) return null;
    const times = kpiDayTimes(set, dateKey);
    return times[times.length - 1];
}

export function kpiCurrentAfter(set, item, now) {
    const { dateKey, min } = kstParts(now);
    if (!isKpiWorkday(dateKey)) return item.after;
    const schedule = kpiDaySchedule(set, item, dateKey);
    if (min < schedule[0].min) return item.after;
    let value = item.after;
    for (const step of schedule) {
        if (step.min <= min) value = step.value;
    }
    return value;
}

export const kpiImprovement = (item, after) => ((item.before - after) / item.before) * 100;
export const kpiTotal = (set, now) => SET_KPI[set].items.reduce(
    (sum, item) => sum + kpiImprovement(item, kpiCurrentAfter(set, item, now)) * item.weight, 0);
