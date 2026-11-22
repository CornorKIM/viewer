// Import this helper in the scheduled handler before starting any transmission.
const LAST_DAY = '2028-12-31';
const HOURS_TO_KST = 9 * 60 * 60 * 1000;
const HOLIDAY_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

async function holidaysForMonth(year, month, serviceKey, fetcher) {
    const url = new URL(HOLIDAY_URL);
    url.search = new URLSearchParams({
        ServiceKey: serviceKey,
        solYear: year,
        solMonth: month,
        pageNo: '1',
        numOfRows: '100',
        _type: 'json',
    }).toString();

    // Report a sanitized error because the request URL contains a key.
    try {
        const reply = await fetcher(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
        });
        if (!reply.ok) throw new Error();
        const { response } = await reply.json();
        if (String(response?.header?.resultCode).padStart(2, '0') !== '00') throw new Error();

        const { totalCount, items } = response.body;
        const record = items?.item;
        const entries = Array.isArray(record) ? record : record ? [record] : [];
        if (!/^\d+$/.test(String(totalCount)) || Number(totalCount) !== entries.length) throw new Error();

        const holidays = [];
        for (const item of entries) {
            const date = String(item.locdate);
            if (!/^\d{8}$/.test(date) || !date.startsWith(year + month)) throw new Error();
            if (!['Y', 'N'].includes(item.isHoliday)) throw new Error();
            if (item.isHoliday === 'Y') holidays.push(date);
        }
        return holidays;
    } catch {
        throw new Error('Unable to verify Korean public holidays.');
    }
}

export async function checkScheduledDay({
    now = new Date(),
    serviceKey = process.env.KR_HOLIDAY_API_KEY,
    fetcher = globalThis.fetch,
} = {}) {
    const kst = new Date(now.getTime() + HOURS_TO_KST);
    const date = kst.toISOString().slice(0, 10);
    if (date > LAST_DAY) return { allowed: false, date, reason: 'schedule_ended' };
    if (kst.getUTCDay() === 0) return { allowed: false, date, reason: 'sunday' };
    if (!serviceKey?.trim()) throw new Error('KR_HOLIDAY_API_KEY is required.');

    const [year, month, day] = date.split('-');
    // New Year's Day provides a basic check that the year is present in the dataset.
    const january = holidaysForMonth(year, '01', serviceKey.trim(), fetcher);
    const current = month === '01' ? january : holidaysForMonth(year, month, serviceKey.trim(), fetcher);
    const [published, holidays] = await Promise.all([january, current]);
    if (!published.includes(year + '0101')) throw new Error('Korean holiday data is missing for this year.');
    if (holidays.includes(year + month + day)) return { allowed: false, date, reason: 'public_holiday' };
    return { allowed: true, date };
}
