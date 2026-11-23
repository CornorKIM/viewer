// Vercel Serverless Function — 브라우저가 InfluxDB(평문 HTTP)를 직접 호출하면
// HTTPS로 배포된 페이지에서는 Mixed Content로 막힙니다. 그래서 이 서버(Vercel) 쪽에서
// 대신 InfluxDB에 물어보고, 브라우저에는 같은 도메인(/api/sensor)으로만 결과를 내려줍니다.
//
// 보안 주의:
// - 토큰은 절대 이 파일에 직접 쓰지 말고 Vercel 환경변수 INFLUX_TOKEN으로 설정하세요.
//   (VITE_ / NEXT_PUBLIC_ 같은 접두어를 쓰면 클라이언트 코드에 노출되니 절대 쓰지 마세요.)
// - 클라이언트가 Flux 쿼리를 자유롭게 보내게 하지 않고, 아래처럼 서버에서
//   쿼리 내용을 고정해서 "허용된 것만" 조회하도록 제한했습니다.

// INFLUX_URL overrides the server (e.g. http://sl-influxdb:8086 in Docker); default = DB server.
const INFLUX_URL = `${(process.env.INFLUX_URL || 'http://175.193.55.102:8086').replace(/\/+$/, '')}/api/v2/query?org=dx`;

// YC_2025 버킷, topic="YC_2025/63476" 센서의 RSSI/ch1/ch2/ch3 최신값.
//
// 이 버킷에는 measurement 가 3개(data, mqtt_consumer, yc_2025_data) 공존하고 그 이름은
// Telegraf 설정이 바뀌면 예고 없이 또 바뀔 수 있어서, _measurement 로는 절대 필터링하지
// 않습니다(수집기가 1대뿐이라 host 필터도 의미 없음). 식별은 topic 태그 + _field 조합만
// 사용하고, "topic+field 만으로는 행이 유일하지 않다"(같은 field 를 여러 measurement 가
// 동시에 들고 있음)는 문제를 last() -> group() -> sort(desc) -> limit(1) 순서로 해결합니다.
const SENSOR_TOPIC = 'YC_2025/63476';
const FLUX_QUERY = `
from(bucket: "YC_2025")
  |> range(start: -1h)
  |> filter(fn: (r) => r.topic == "${SENSOR_TOPIC}")
  |> filter(fn: (r) => r._field == "RSSI" or r._field == "ch1" or r._field == "ch2" or r._field == "ch3")
  |> last()
  |> group(columns: ["_field"])
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 1)
`;

// InfluxDB가 돌려주는 "annotated CSV"는 테이블(그룹)이 여러 개라 헤더 줄이
// 여러 번 나올 수 있습니다. 그래서 줄마다 "이게 헤더인지 데이터인지"를 판단하며
// 파싱해서 { RSSI: {value, time}, ch1: {...}, ... } 형태로 만들어 돌려줍니다.
function parseFluxCSV(text) {
    const rawLines = text.split('\n').map((l) => l.trim());
    const result = {};
    let header = null;

    for (const line of rawLines) {
        if (!line || line.startsWith('#')) continue;
        const cols = line.split(',');

        if (cols.includes('_field') && cols.includes('_value')) {
            header = cols; // 새 테이블의 헤더 줄
            continue;
        }
        if (!header || cols.length !== header.length) continue;

        const fieldIdx = header.indexOf('_field');
        const valueIdx = header.indexOf('_value');
        const timeIdx = header.indexOf('_time');
        const field = cols[fieldIdx];
        const value = Number(cols[valueIdx]);
        const time = timeIdx !== -1 ? cols[timeIdx] : null;
        if (field) result[field] = { value, time };
    }

    return result;
}

export default async function handler(req, res) {
    if (!process.env.INFLUX_TOKEN) {
        res.status(500).json({ error: 'INFLUX_TOKEN 환경변수가 설정되지 않았습니다.' });
        return;
    }

    try {
        const influxRes = await fetch(INFLUX_URL, {
            method: 'POST',
            headers: {
                Authorization: `Token ${process.env.INFLUX_TOKEN}`,
                'Content-Type': 'application/vnd.flux',
                Accept: 'application/csv',
            },
            body: FLUX_QUERY,
        });

        if (!influxRes.ok) {
            const detail = await influxRes.text();
            res.status(502).json({ error: 'influx_query_failed', status: influxRes.status, detail });
            return;
        }

        const csv = await influxRes.text();
        const parsed = parseFluxCSV(csv);

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(parsed);
    } catch (err) {
        res.status(500).json({ error: 'proxy_failed', message: String(err) });
    }
}
