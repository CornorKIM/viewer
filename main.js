import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SET_KPI, kpiCurrentAfter, kpiImprovement, kpiTotal, kpiSendMin, kstParts, kstDate } from './kpi.js';

// =====================================================================
// 2×2 멀티뷰 — 화면을 4개 구역으로 나누고 각 구역이 설비 1대(모델)를 비춤.
//   1번 화면(좌상) ↔ 설비 A(목공소 봄)    2번 화면(우상) ↔ 설비 B(이레공방)
//   3번 화면(좌하) ↔ 설비 C(브랜드스미스) 4번 화면(우하) ↔ 설비 D(비스트럭처)
// 좌표계: X 좌우 / Y 상하 / Z 높이(Z-up), 단위 mm. 카메라는 화면별 Orthographic(등각).
// =====================================================================

const MOVE_SPEED = 3000; // 이동 속도 (초당 거리, mm)
const ZOOM_SPEED = 1.5; // 초당 배율 변화량 (Z/X)
const WHEEL_ZOOM_STEP = 0.1; // 마우스휠 한 틱당 확대·축소 비율 (10%)
const MIN_VIEW_HEIGHT = 50; // 최대 확대 한계(mm)

const MACHINE_POLL_INTERVAL = 1000;
const CLICK_MARKER_RADIUS = 40;

// 화면 번호(1~4) → 모델(설비 세트). 순서 변경 시 이 배열만 수정.
const VIEW_SETS = ['A', 'B', 'C', 'D'];

// 설비 코드(A~D) → 화면 표시명. 코드(A~D)는 유지하고 표시명만 변경.
const SET_NAMES = {
    A: '목공소 봄',
    B: '이레공방',
    C: '브랜드스미스',
    D: '비스트럭처',
};

const VIEW_FIT_MARGIN = 1.3; // 모델이 화면에 꽉 차지 않도록 여유 배율
const VIEW_DEFAULT_HEIGHT = 6000; // 모델 로드 전 임시 화면 세로 범위(mm)

// ACTION 임의 이동 범위(기준 위치 대비 오프셋, mm) — 화면 맞춤(fit)에도 사용. 실제 DB 좌표는 제한하지 않음.
// 보기 편하게 정한 값: X = BODY 폭 안, Y = BODY 길이 안, Z = -100 ~ 200
const AXIS_MOVE_RANGE = {
    x: [-600, 600],
    y: [-1100, 1450],
    z: [-100, 200],
};

// 업체(세트) 간 배치 간격 배율 — 원래 공장 배치(X 방향 약 3.85m 간격) 대비.
// 2×2 화면에서 옆 업체 설비가 보이지 않도록 10배. A 위치는 고정, B~D를 X 방향으로 벌림.
const SET_SPACING_SCALE = 10;
// 원래 배치(mm) — 이전 FACTORY.glb 안 설비 몸체(BODY~BODY003) 자리. BASE 윗면과 BODY 바닥이 Z=10mm
const SET_MACHINE_OFFSET_ORIGINAL = {
    A: [1119.3, 2035.9, 910.0],
    B: [4968.6, 2035.9, 910.0],
    C: [8818.0, 2035.9, 910.0],
    D: [12667.3, 2035.9, 910.0],
};
const spreadSetX = (positions) => Object.fromEntries(Object.entries(positions).map(([set, [x, y, z]]) => {
    const shift = (SET_MACHINE_OFFSET_ORIGINAL[set][0] - SET_MACHINE_OFFSET_ORIGINAL.A[0]) * (SET_SPACING_SCALE - 1);
    return [set, [x + shift, y, z]];
}));
// 세트별 설비·바닥 배치 위치(mm)
const SET_MACHINE_OFFSET = spreadSetX(SET_MACHINE_OFFSET_ORIGINAL);

// 세트별 고정 라벨 위치(원래 배치 기준 값을 설비와 같은 만큼 이동) — 모델 로드 전 각 화면의 임시 중심점으로도 사용
const AXIS_STATUS_LABEL_POS = spreadSetX({
    A: [1233, 833, 0],
    B: [5446, 1376, 10],
    C: [9501, 1201, 10],
    D: [13316, 1089, 10],
});

// 등각투상 시작 각도
const ORBIT_RADIUS = 3000 * Math.sqrt(3);
const ORBIT_ELEVATION_MIN = 0.05;
const ORBIT_ELEVATION_MAX = Math.PI / 2 - 0.05;
const ORBIT_AZIMUTH_START = -Math.PI / 4;
const ORBIT_ELEVATION_START = Math.asin(1 / Math.sqrt(3)); // 약 35.26도
const ROTATE_SPEED = Math.PI / 2; // 라디안/초 (90도/초)

// ---------------------------------------------------------------------
// 기본 셋업
// ---------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2e3236);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(1, -1, 2);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 1);
fillLight.position.set(-1, 1, 1);
scene.add(fillLight);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AxesHelper(100));

// ---------------------------------------------------------------------
// 화면(뷰) 4개 — 각자 카메라·중심점·각도·배율을 독립적으로 가짐
// ---------------------------------------------------------------------
function createViewCamera() {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    camera.up.set(0, 0, 1);
    return camera;
}

const views = VIEW_SETS.map((set, index) => {
    const [fx, fy, fz] = AXIS_STATUS_LABEL_POS[set];
    return {
        no: index + 1,
        set,
        camera: createViewCamera(),
        target: new THREE.Vector3(fx, fy, fz),
        azimuth: ORBIT_AZIMUTH_START,
        elevation: ORBIT_ELEVATION_START,
        viewHeight: VIEW_DEFAULT_HEIGHT,
    };
});

const allViews = views;

// 전체 화면(단축키 F) — 선택한 업체 화면 1개를 창 전체로 확대. false = 2×2 분할
let maximized = false;
let activeView = views[0]; // 키보드 조작 대상 — 화면 클릭 시 변경. 전체 화면에서는 확대된 화면

function viewName(view) {
    return SET_NAMES[view.set];
}

function visibleViews() {
    return maximized ? [activeView] : views;
}

// 화면 영역(CSS px, 좌상단 원점)
function getViewRect(view) {
    if (maximized && view === activeView) {
        return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    }
    const w = window.innerWidth / 2;
    const h = window.innerHeight / 2;
    const col = (view.no - 1) % 2;
    const row = Math.floor((view.no - 1) / 2);
    return { x: col * w, y: row * h, w, h };
}

function viewAtPoint(clientX, clientY) {
    if (maximized) return activeView;
    const col = clientX < window.innerWidth / 2 ? 0 : 1;
    const row = clientY < window.innerHeight / 2 ? 0 : 1;
    return views[row * 2 + col];
}

function updateViewCamera(view) {
    const { w, h } = getViewRect(view);
    const aspect = w / h;
    const halfH = view.viewHeight / 2;
    const halfW = halfH * aspect;
    const cam = view.camera;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();

    const horizontal = ORBIT_RADIUS * Math.cos(view.elevation);
    cam.position.set(
        view.target.x + horizontal * Math.cos(view.azimuth),
        view.target.y + horizontal * Math.sin(view.azimuth),
        view.target.z + ORBIT_RADIUS * Math.sin(view.elevation)
    );
    cam.lookAt(view.target);
    cam.updateMatrixWorld();
}

// 모델 박스(이동 범위 포함)가 화면에 들어오도록 중심점·배율 자동 설정
function fitViewToBox(view, box, margin = VIEW_FIT_MARGIN) {
    view.target.copy(box.getCenter(new THREE.Vector3()));
    updateViewCamera(view);

    const inv = view.camera.matrixWorldInverse;
    let maxX = 0;
    let maxY = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
        p.set(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z
        ).applyMatrix4(inv);
        maxX = Math.max(maxX, Math.abs(p.x));
        maxY = Math.max(maxY, Math.abs(p.y));
    }
    const { w, h } = getViewRect(view);
    const aspect = w / h;
    view.viewHeight = Math.max(MIN_VIEW_HEIGHT, Math.max(2 * maxY, (2 * maxX) / aspect) * margin);
    updateViewCamera(view);
}

allViews.forEach(updateViewCamera);

// ---------------------------------------------------------------------
// 화면 구분선·제목 (HTML 오버레이)
// ---------------------------------------------------------------------
const viewGridEl = document.getElementById('viewGrid');
const viewFrames = views.map((view) => {
    const frame = document.createElement('div');
    frame.className = 'view-frame';
    const title = document.createElement('div');
    title.className = 'view-title';
    title.textContent = SET_NAMES[view.set];
    frame.appendChild(title);
    if (viewGridEl) viewGridEl.appendChild(frame);
    return frame;
});

// ---------------------------------------------------------------------
// 핵심성과지표(KPI) 카드 — 화면(업체)마다 좌하단. 단축키 K.
// ---------------------------------------------------------------------
// 화면 갱신 확인 주기 — 값이 바뀔 때만 다시 그림
const KPI_REFRESH_MS = 30 * 1000;

const fmtPct = (v) => `${v.toFixed(2)}%`;
const fmtKpiNum = (v) => String(Number(v.toFixed(2)));

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function buildKpiTable(headers, rows) {
    const table = el('table');
    const headRow = el('tr');
    headers.forEach((h) => headRow.appendChild(el('th', null, h)));
    table.appendChild(el('thead')).appendChild(headRow);
    const body = table.appendChild(el('tbody'));
    rows.forEach((cells) => {
        const tr = body.appendChild(el('tr'));
        cells.forEach(([text, cls]) => tr.appendChild(el('td', cls, text)));
    });
    return table;
}

function renderKpiCard(card, set, now) {
    const head = el('div', 'kpi-head');
    head.appendChild(el('span', null, `핵심성과지표 · ${SET_KPI[set].product}`));
    head.appendChild(el('span', 'kpi-total', `종합 ${fmtPct(kpiTotal(set, now))}`));
    card.replaceChildren(head, buildKpiTable(
        ['지표', '구축 전', '목표', '구축 후', '개선율'],
        SET_KPI[set].items.map((item) => {
            const after = kpiCurrentAfter(set, item, now);
            return [
                [`${item.code} ${item.name}(${item.unit})`],
                [fmtKpiNum(item.before), 'num'],
                [fmtKpiNum(item.target), 'num'],
                [fmtKpiNum(after), 'num'],
                [fmtPct(kpiImprovement(item, after)), 'num kpi-rate'],
            ];
        })
    ));
}

const kpiCards = views.map((view, i) => {
    const card = el('div', 'kpi-card');
    card.id = `kpi-${view.set}`;
    viewFrames[i].appendChild(card);
    return { card, set: view.set };
});

let kpiShownValues = '';
function renderKpi() {
    const now = new Date();
    const values = VIEW_SETS.map((set) => SET_KPI[set].items.map((item) => kpiCurrentAfter(set, item, now)).join(',')).join('|');
    if (values === kpiShownValues) return;
    kpiShownValues = values;
    kpiCards.forEach(({ card, set }) => renderKpiCard(card, set, now));
    placeKpiCards();
}
renderKpi();
setInterval(renderKpi, KPI_REFRESH_MS);

// ---------------------------------------------------------------------
// 설비 데이터 카드(화면 우상단) — 2×2: 화면마다 해당 업체, 전체 화면: 4개사 비교표. 단축키 V.
// 내용은 pollMachine 응답마다 renderMachinePanel()에서 갱신.
// ---------------------------------------------------------------------
const machineCards = {}; // set -> element
views.forEach((view, i) => {
    const card = el('div', 'machine-card');
    card.id = `machine-${view.set}`;
    card.appendChild(el('div', 'machine-sub', '(수신 대기)'));
    viewFrames[i].appendChild(card);
    machineCards[view.set] = card;
});

// ---------------------------------------------------------------------
// 모델 앞 실시간 축 이동값 라벨 — Z축 헤드 위(로드 전엔 AXIS_STATUS_LABEL_POS)를 각 화면에 투영해 HTML로 표시.
// 헤드를 따라 움직임. 화면마다 해당 업체 1개. 값 = 세트별 X/Y/Z 이동값(mm).
// ---------------------------------------------------------------------
const COORD_AXES = ['x', 'y', 'z'];
const coordLabels = []; // { view, set, box, values, anchor }
function addCoordLabel(view, set, frame, showName) {
    const box = el('div', 'coord-label');
    if (showName) box.appendChild(el('div', 'coord-name', SET_NAMES[set]));
    const values = {};
    for (const axis of COORD_AXES) {
        const row = box.appendChild(el('div', 'coord-row'));
        row.appendChild(el('span', `coord-axis ax-${axis}`, axis.toUpperCase()));
        values[axis] = row.appendChild(el('span', 'coord-value', '-'));
        row.appendChild(el('span', 'coord-unit', 'mm'));
    }
    frame.appendChild(box);
    coordLabels.push({ view, set, box, values, anchor: new THREE.Vector3(...AXIS_STATUS_LABEL_POS[set]) });
}
views.forEach((view, i) => addCoordLabel(view, view.set, viewFrames[i], false));

const coordProjected = new THREE.Vector3();
const formatSignedMm = (v) => `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(3)}`;
function updateCoordLabels() {
    const shown = visibleViews();
    for (const label of coordLabels) {
        if (!shown.includes(label.view)) continue; // 숨긴 프레임 안에 있으므로 갱신 불필요
        const e = axisSets[label.set];
        if (e && e.zPart && e.zLabelOffset) coordProjected.copy(e.zPart.position).add(e.zLabelOffset);
        else coordProjected.copy(label.anchor);
        coordProjected.project(label.view.camera);
        const inView = Math.abs(coordProjected.x) <= 1 && Math.abs(coordProjected.y) <= 1 && coordProjected.z <= 1;
        label.box.style.display = inView ? '' : 'none';
        if (!inView) continue;
        const r = getViewRect(label.view);
        label.box.style.left = `${((coordProjected.x + 1) / 2) * r.w}px`;
        label.box.style.top = `${((1 - coordProjected.y) / 2) * r.h}px`;
        const pos = e ? e.lastPos : null;
        for (const axis of COORD_AXES) {
            const text = pos ? formatSignedMm(pos[axis]) : '-';
            if (label.values[axis].textContent !== text) label.values[axis].textContent = text;
        }
    }
}

// 화면 높이가 낮으면 1번 화면 KPI 카드가 좌상단 토글 패널에 가려지므로 패널 오른쪽으로 비켜 놓음
function placeKpiCards() {
    const togglesEl = document.getElementById('toggles');
    if (!togglesEl) return;
    const t = togglesEl.getBoundingClientRect();
    document.querySelectorAll('.kpi-card').forEach((card) => {
        card.style.left = '';
        const r = card.getBoundingClientRect();
        if (r.width === 0 || !card.offsetParent) return; // 숨김 상태
        const overlaps = r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top;
        if (overlaps) card.style.left = `${t.right - card.offsetParent.getBoundingClientRect().left + 10}px`;
    });
}
window.addEventListener('resize', placeKpiCards);

function updateActiveFrame() {
    viewFrames.forEach((frame, i) => frame.classList.toggle('active', views[i] === activeView));
}
updateActiveFrame();

// 전체 화면 ↔ 2×2 분할 전환 — 전체 화면은 선택한(노란 테두리) 업체 화면 1개를 창 전체로 확대
function setMaximized(on) {
    maximized = on;
    if (viewGridEl) viewGridEl.classList.toggle('maximized', on);
    updateActiveFrame();
    placeKpiCards();
}

// ---------------------------------------------------------------------
// 표시 on/off 토글 — 우측 좌표 팝업(#coords), 우측 설비 데이터 팝업(#machine), 하단 조작법(#info), KPI 카드
// 상태는 브라우저에 저장되어 새로고침 후에도 유지. 단축키 C(좌표), V(데이터), H(조작법), K(KPI).
// ---------------------------------------------------------------------
const DISPLAY_TOGGLES = [
    { key: 'overview', buttonId: 'toggleOverview', targetIds: [], label: '전체 화면', hotkey: 'KeyF', defaultOn: false, onChange: setMaximized },
    { key: 'coords', buttonId: 'toggleCoords', targetIds: ['coords'], label: '좌표', hotkey: 'KeyC' },
    { key: 'signals', buttonId: 'toggleSignals', targetIds: VIEW_SETS.map((set) => `machine-${set}`), label: '데이터', hotkey: 'KeyV' },
    { key: 'help', buttonId: 'toggleHelp', targetIds: ['info'], label: '조작법', hotkey: 'KeyH' },
    { key: 'kpi', buttonId: 'toggleKpi', targetIds: VIEW_SETS.map((set) => `kpi-${set}`), label: 'KPI', hotkey: 'KeyK', onChange: placeKpiCards },
];
const TOGGLE_STORAGE_PREFIX = 'viewer.toggle.';

function readToggleState(key, defaultOn = true) {
    try {
        const saved = localStorage.getItem(TOGGLE_STORAGE_PREFIX + key);
        if (saved === null) return defaultOn;
        return saved !== 'off';
    } catch {
        return defaultOn; // 저장소 사용 불가 시 기본값
    }
}

function writeToggleState(key, visible) {
    try {
        localStorage.setItem(TOGGLE_STORAGE_PREFIX + key, visible ? 'on' : 'off');
    } catch {
        // 저장 실패는 무시 (표시 전환은 정상 동작)
    }
}

function applyToggle(t, visible) {
    t.visible = visible;
    t.targetIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !visible);
    });
    const btn = document.getElementById(t.buttonId);
    if (btn) {
        btn.classList.toggle('on', visible); // 스위치 색·손잡이 위치는 CSS(.on)로 표시
        btn.setAttribute('aria-checked', String(visible));
    }
    if (t.onChange) t.onChange(visible);
}

DISPLAY_TOGGLES.forEach((t) => {
    applyToggle(t, readToggleState(t.key, t.defaultOn !== false));
    const btn = document.getElementById(t.buttonId);
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyToggle(t, !t.visible);
            writeToggleState(t.key, t.visible);
            btn.blur(); // 버튼 포커스가 키보드 조작(WASD 등)을 가로채지 않게
        });
    }
});

document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const t = DISPLAY_TOGGLES.find((d) => d.hotkey === e.code);
    if (!t) return;
    applyToggle(t, !t.visible);
    writeToggleState(t.key, t.visible);
});

// ---------------------------------------------------------------------
// ACTION 버튼(단축키 R) — 실제 데이터가 없는 설비의 X/Y/Z 축을 임의로 움직임. 누를 때마다 켜기/끄기.
// 저장하지 않음(새로고침하면 꺼짐 = 기본 정지). 그날 KPI 메일 발송 시각 전에 켰다면 발송 시각에 자동으로 꺼짐.
// ---------------------------------------------------------------------
const ACTION_CHECK_MS = 10 * 1000;
const actionBtn = document.getElementById('toggleAction');
let actionOn = false;
let actionStartedAt = 0;

function setAction(on) {
    actionOn = on;
    actionStartedAt = on ? Date.now() : 0;
    if (actionBtn) {
        actionBtn.classList.toggle('on', on);
        actionBtn.setAttribute('aria-checked', String(on));
    }
}

function todayKpiSendTime() {
    const { dateKey } = kstParts(new Date());
    const min = kpiSendMin(dateKey);
    return min === null ? null : kstDate(dateKey, min).getTime();
}

function checkActionAutoStop() {
    if (!actionOn) return;
    const sendAt = todayKpiSendTime();
    if (sendAt !== null && actionStartedAt < sendAt && Date.now() >= sendAt) setAction(false);
}

if (actionBtn) {
    actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setAction(!actionOn);
        actionBtn.blur();
    });
}
document.addEventListener('keydown', (e) => {
    if (!e.repeat && e.code === 'KeyR') setAction(!actionOn);
});
setInterval(checkActionAutoStop, ACTION_CHECK_MS);

// 오른쪽 위 좌표 HUD
const coordsEl = document.getElementById('coords');

// 응답(DB 조회 수 초)이 폴링 주기보다 느려도 요청이 쌓이지 않게: 이전 요청이 끝난 뒤 주기만큼 쉬고 다시 조회
function startPolling(fn, interval) {
    const tick = async () => {
        try {
            await fn();
        } finally {
            setTimeout(tick, interval);
        }
    };
    tick();
}

// ---------------------------------------------------------------------
// 설비 실제 위치 (PostgreSQL, syntec_cnc.raw_data) — /api/machine (Vercel 서버리스
// 함수)를 통해서만 조회.
// ---------------------------------------------------------------------

// 설비 데이터 카드 항목 — DB(collected_data) 필드 → 화면 항목명, group 단위로 묶어 표시.
// toMm: DB 좌표 원값 × DB_POS_TO_MM(0.001) → mm 소수 3자리 (584922.0 → 584.922).
// rpm·mm/min 단위는 Syntec 일반 단위 기준.
const MACHINE_RAW_FIELDS = [
    { key: 'core_status', type: 'int', group: '운전', label: '운전 상태', codes: 'status' },
    { key: 'core_mode', type: 'int', group: '운전', label: '운전 모드', codes: 'mode' },
    { key: 'core_count', type: 'int', group: '운전', label: '가공 횟수' },
    { key: 'core_program', type: 'string', group: '운전', label: '실행 프로그램' },
    { key: 'core_alarm', type: 'string', group: '운전', label: '알람' },
    { key: 'pos_x', type: 'float', group: '위치 (mm)', label: '기계 좌표 X', toMm: true },
    { key: 'pos_y', type: 'float', group: '위치 (mm)', label: '기계 좌표 Y', toMm: true },
    { key: 'pos_z', type: 'float', group: '위치 (mm)', label: '기계 좌표 Z', toMm: true },
    { key: 'speed_spindle', type: 'float', group: '스핀들·이송', label: '스핀들 회전수 (rpm)' },
    { key: 'pwr_spindle', type: 'float', group: '스핀들·이송', label: '스핀들 전력' },
    { key: 'feedrate', type: 'float', group: '스핀들·이송', label: '이송 속도 (mm/min)' },
    { key: 'tool_id', type: 'int', group: '스핀들·이송', label: '공구 번호' },
];
// 운전 상태·모드 코드 → 의미. 수집 장비 제공사 코드표 확인 후 입력 (예: status: { 1: '가동' }).
// 비어 있으면 숫자만 표시.
const MACHINE_CODE_LABELS = { status: {}, mode: {} };

function formatMachineValue(v, type) {
    if (v === null || v === undefined || v === '') return '-';
    if (type === 'string') return String(v);
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return type === 'int' ? String(Math.trunc(n)) : n.toFixed(1);
}

function formatCollectedAt(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatMachineField(f, v) {
    if (f.toMm && v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))) {
        return (Number(v) * DB_POS_TO_MM).toFixed(3);
    }
    const text = formatMachineValue(v, f.type);
    const meaning = f.codes ? MACHINE_CODE_LABELS[f.codes][text] : undefined;
    return meaning ? `${text} (${meaning})` : text;
}

function buildMachineTable(raw) {
    // 고정 항목이 하나도 없으면 DB가 내려준 컬럼을 그대로 표시
    const fields = MACHINE_RAW_FIELDS.some((f) => raw[f.key] !== undefined)
        ? MACHINE_RAW_FIELDS
        : Object.keys(raw).filter((k) => k !== 'created_at').map((k) => ({ key: k, type: 'float', label: k }));
    const table = el('table');
    const body = table.appendChild(el('tbody'));
    let group = null;
    for (const f of fields) {
        if (f.group && f.group !== group) {
            group = f.group;
            body.appendChild(el('tr', 'machine-group')).appendChild(el('th', null, group)).colSpan = 2;
        }
        const tr = body.appendChild(el('tr'));
        tr.appendChild(el('td', null, f.label));
        tr.appendChild(el('td', 'num', formatMachineField(f, raw[f.key])));
    }
    return table;
}

// ---------------------------------------------------------------------
// DB 좌표 → 모델 연동 — /api/machine(PostgreSQL syntec_cnc.raw_data)에서 설비별
// (EQUIPMENT_NO) 최신 1행을 받아 pos_x/pos_y/pos_z 를 각 설비의 X/Y/Z 축 이동값으로 사용.
// ---------------------------------------------------------------------
// 설비 코드(A~D) → DB EQUIPMENT_NO
const SET_EQUIPMENT_NO = {
    A: '24424', // 목공소 봄
    B: '42504', // 이레공방
    C: '02895', // 브랜드스미스
    D: '75980', // 비스트럭처
};
// DB 좌표를 모델에 반영할지 여부. false = 신호 없음으로 간주 → 모든 설비 랜덤 이동
// (현재 들어오는 값은 테스트용 신호기 값이라 반영하지 않음. 실제 신호 연결 후 true로 변경)
const DB_LINK_ENABLED = true;
// 마지막 수집 시각이 이보다 오래된 행은 신호 없음으로 봄(예전 테스트 값 등 멈춘 데이터 제외)
const DB_FRESH_MS = 5 * 60 * 1000;
function isFreshRow(row) {
    const t = Date.parse(row.created_at);
    return Number.isFinite(t) && Date.now() - t <= DB_FRESH_MS;
}
const DB_POS_FIELDS = { x: 'pos_x', y: 'pos_y', z: 'pos_z' }; // 기계좌표. 공구 끝 기준이면 tcp_x/tcp_y/tcp_z
const DB_POS_TO_MM = 0.001; // DB 값 → mm 환산 배율 (DB 255999.0 → 255.999mm)
const DB_POS_OFFSET = { x: 0, y: 0, z: 0 }; // 기계 원점과 모델 기준 위치 차이 보정(mm)
const DB_SMOOTHING = 8; // 1초 간격 값 사이를 부드럽게 잇는 정도 (클수록 빠르게 따라감)

const dbPos = {}; // set -> { target, current }
const dbOnline = {}; // set -> true(신호 수신 중) / false(신호 없음 → 랜덤 이동)
const axisSets = {}; // set -> { xMover, yMover, zMover, lastPos, mode, xPart, yPart, zPart, *Base* }
const dbRows = {}; // set -> 최신 DB 행 (없으면 null)

// DB 값 → 모델 이동값(mm). 실제 좌표를 범위 제한 없이 그대로 사용
// (AXIS_MOVE_RANGE는 신호 없을 때의 랜덤 이동 범위와 화면 맞춤에만 사용).
function updateDbTarget(set, data) {
    const t = {};
    for (const axis of ['x', 'y', 'z']) {
        const raw = Number(data[DB_POS_FIELDS[axis]]);
        if (!Number.isFinite(raw)) return false;
        t[axis] = raw * DB_POS_TO_MM + DB_POS_OFFSET[axis];
    }
    if (!dbPos[set]) dbPos[set] = { target: t, current: { ...t } };
    else dbPos[set].target = t;
    return true;
}

// 매 프레임 현재값을 목표값 쪽으로 부드럽게 이동. 아직 수신 전이면 null.
function stepDbPos(set, dt) {
    const p = dbPos[set];
    if (!p) return null;
    const k = 1 - Math.exp(-DB_SMOOTHING * dt);
    for (const axis of ['x', 'y', 'z']) {
        p.current[axis] += (p.target[axis] - p.current[axis]) * k;
    }
    return p.current;
}

// 화면 제목에 설비별 수신 상태 표시
function setDbLinkStatus(set, ok) {
    const i = views.findIndex((v) => v.set === set);
    const title = i >= 0 ? viewFrames[i].querySelector('.view-title') : null;
    if (title) title.textContent = ok ? `${SET_NAMES[set]} · DB 연동` : SET_NAMES[set];
    dbOnline[set] = ok;
}
VIEW_SETS.forEach((set) => setDbLinkStatus(set, false));

// 설비 데이터 카드 갱신 — 화면별(해당 업체) 카드
let machinePanelError = '';
function renderMachinePanel() {
    for (const set of VIEW_SETS) {
        const card = machineCards[set];
        const row = dbRows[set];
        card.replaceChildren(
            el('div', 'machine-head', `설비 데이터 · ${SET_EQUIPMENT_NO[set]}`),
            el('div', 'machine-sub', machinePanelError || (row ? `수집 시각 ${formatCollectedAt(row.created_at)}` : '(데이터 없음)'))
        );
        if (!machinePanelError && row) card.appendChild(buildMachineTable(row));
    }
}

async function pollMachine() {
    try {
        const eq = VIEW_SETS.map((set) => SET_EQUIPMENT_NO[set]).join(',');
        const res = await fetch(`/api/machine?eq=${encodeURIComponent(eq)}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        machinePanelError = '';
        for (const set of VIEW_SETS) {
            const row = data[SET_EQUIPMENT_NO[set]] || null;
            dbRows[set] = row;
            setDbLinkStatus(set, DB_LINK_ENABLED && row && isFreshRow(row) ? updateDbTarget(set, row) : false);
        }
    } catch (err) {
        machinePanelError = '(연결 실패)';
        VIEW_SETS.forEach((set) => setDbLinkStatus(set, false));
    }
    renderMachinePanel();
}

// 팝업 표시 여부와 관계없이 계속 조회 (모델 연동에 사용)
startPolling(pollMachine, MACHINE_POLL_INTERVAL);

// ---------------------------------------------------------------------
// 텍스트 스프라이트
// ---------------------------------------------------------------------
function createTextSprite(textColor = '#ffee88', opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = opts.width || 512;
    canvas.height = opts.height || 128;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const [sx, sy] = opts.scale || [800, 200];

    let sprite;
    if (opts.billboard === false) {
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthTest: false });
        sprite = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), material);
    } else {
        const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        sprite = new THREE.Sprite(material);
        sprite.scale.set(sx, sy, 1);
    }
    return {
        sprite, canvas, ctx, texture, textColor, lastText: '',
        fontSize: opts.fontSize || 36,
        lineHeight: opts.lineHeight || 40,
        align: opts.align || 'center',
    };
}

function updateTextSprite(label, text) {
    if (!label || text === label.lastText) return;
    label.lastText = text;
    const { ctx, canvas, texture } = label;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `bold ${label.fontSize}px monospace`;
    ctx.fillStyle = label.textColor || '#ffee88';
    ctx.textAlign = label.align;
    ctx.textBaseline = 'middle';

    const lines = String(text).split('\n');
    const lineHeight = label.lineHeight;
    const startY = canvas.height / 2 - (lineHeight * (lines.length - 1)) / 2;
    const x = label.align === 'left' ? 16 : canvas.width / 2;
    lines.forEach((line, i) => {
        ctx.fillText(line, x, startY + i * lineHeight);
    });

    texture.needsUpdate = true;
}

// 클릭 좌표 확인 시 먼저 검사할 실제 지오메트리 — 안 맞으면 Z=0 평면으로 대체
const raycastTargets = [];

// 설비·바닥 모델 — 3ds Max에서 내보낸 GLB(미터 단위, Y-up). 파일 하나를 읽어 설비 A~D에 복제 배치.
// (이전 FACTORY.glb(50MB)는 바닥 용도로만 쓰여 BASE.glb(2KB)로 대체)
// 변환: ×1000(m → mm), X축 기준 +90도 회전(Y-up → Z-up) → 원본 CAD(mm) 좌표 그대로 복원.
const MACHINE_PART_FILES = { base: 'BASE.glb', body: 'BODY.glb', x: 'XBODY.glb', y: 'YBODY.glb', z: 'ZBODY.glb' };
const MACHINE_MODEL_SCALE = 1000;
// 세트별 배치 위치는 상단 SET_MACHINE_OFFSET (업체 간 간격 SET_SPACING_SCALE 적용)

const machineTemplates = {}; // key -> Promise<Object3D>
function loadMachineTemplate(key) {
    if (!machineTemplates[key]) {
        const fileName = MACHINE_PART_FILES[key];
        machineTemplates[key] = new Promise((resolve, reject) => {
            new GLTFLoader().load(`/models/${fileName}`, (gltf) => resolve(gltf.scene), undefined, (err) => {
                console.error(`${fileName} 로드 실패:`, err);
                reject(err);
            });
        });
    }
    return machineTemplates[key];
}

// 세트마다 복제본 생성 (형상·재질은 템플릿과 공유)
function addMachinePart(key, set, onLoaded) {
    loadMachineTemplate(key).then((template) => {
        const obj = template.clone(true);
        obj.traverse((child) => {
            if (child.isMesh) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((m) => { if (m) m.side = THREE.DoubleSide; });
            }
        });
        obj.scale.setScalar(MACHINE_MODEL_SCALE);
        obj.rotation.x = Math.PI / 2;
        obj.position.set(...SET_MACHINE_OFFSET[set]);
        scene.add(obj);
        obj.updateMatrixWorld(true);
        if (onLoaded) onLoaded(obj);
    }).catch(() => { /* 로드 실패는 loadMachineTemplate 에서 콘솔 출력 */ });
}

// DB 신호가 없을 때 사용하는 랜덤 이동 — 범위 안의 랜덤 목표 지점으로 랜덤 시간 동안 이동
const RANDOM_MOVE_MIN_DURATION = 2; // 초
const RANDOM_MOVE_MAX_DURATION = 6; // 초

function createRandomMover(min, max) {
    const pick = () => min + Math.random() * (max - min);
    const pickDuration = () => RANDOM_MOVE_MIN_DURATION + Math.random() * (RANDOM_MOVE_MAX_DURATION - RANDOM_MOVE_MIN_DURATION);
    const state = { from: pick(), to: pick(), duration: pickDuration(), elapsed: 0 };
    return {
        // 현재 위치에서 이어서 움직이도록 시작점 재설정 (DB → 랜덤 전환 시 튐 방지)
        reset(from) {
            state.from = from;
            state.to = pick();
            state.duration = pickDuration();
            state.elapsed = 0;
        },
        update(dt) {
            state.elapsed += dt;
            const t = Math.min(1, state.elapsed / state.duration);
            const eased = (1 - Math.cos(Math.PI * t)) / 2;
            const value = state.from + (state.to - state.from) * eased;
            if (t >= 1) {
                state.from = state.to;
                state.to = pick();
                state.duration = pickDuration();
                state.elapsed = 0;
            }
            return value;
        },
    };
}

// 세트 안에서만 Y→X, X→Z로 이동값이 이어짐(갠트리 구조), 세트끼리는 독립.

// 세트의 X/Y/Z 파트 3개가 모두 로드되면 해당 화면을 모델에 맞춤
function onAxisPartLoaded(set) {
    const e = axisSets[set];
    if (!e.xPart || !e.yPart || !e.zPart || !e.bodyPart) return;
    const view = views.find((v) => v.set === set);
    if (!view) return;

    const box = new THREE.Box3();
    [e.xPart, e.yPart, e.zPart].forEach((part) => {
        part.updateMatrixWorld(true);
        box.expandByObject(part);
    });
    // 축이 움직이는 범위까지 포함해서 화면에서 벗어나지 않게 확장
    box.min.x += Math.min(...AXIS_MOVE_RANGE.x);
    box.max.x += Math.max(...AXIS_MOVE_RANGE.x);
    box.min.y += Math.min(...AXIS_MOVE_RANGE.y);
    box.max.y += Math.max(...AXIS_MOVE_RANGE.y);
    box.min.z += Math.min(...AXIS_MOVE_RANGE.z);
    box.max.z += Math.max(...AXIS_MOVE_RANGE.z);
    box.expandByObject(e.bodyPart); // 고정 몸체(BODY)도 화면 안에 들어오게
    fitViewToBox(view, box);
}

VIEW_SETS.forEach((set) => {
    const entry = {
        xMover: createRandomMover(...AXIS_MOVE_RANGE.x),
        yMover: createRandomMover(...AXIS_MOVE_RANGE.y),
        zMover: createRandomMover(...AXIS_MOVE_RANGE.z),
        lastPos: { x: 0, y: 0, z: 0 }, // 마지막으로 화면에 반영한 이동값
        mode: 'hold', // 'db'(실제 데이터) / 'random'(ACTION) / 'hold'(정지) — 전환 시점 판단용
        bodyPart: null, xPart: null, yPart: null, zPart: null,
        xBaseX: 0, xBaseY: 0, yBaseY: 0, zBaseX: 0, zBaseY: 0, zBaseZ: 0,
    };
    axisSets[set] = entry;

    addMachinePart('base', set, (obj) => {
        raycastTargets.push(obj); // 바닥 클릭 시 바닥 표면 좌표 확인
    });
    addMachinePart('body', set, (obj) => {
        entry.bodyPart = obj;
        raycastTargets.push(obj);
        onAxisPartLoaded(set);
    });
    addMachinePart('x', set, (obj) => {
        entry.xPart = obj;
        entry.xBaseX = obj.position.x;
        entry.xBaseY = obj.position.y;
        onAxisPartLoaded(set);
    });
    addMachinePart('y', set, (obj) => {
        entry.yPart = obj;
        entry.yBaseY = obj.position.y;
        onAxisPartLoaded(set);
    });
    addMachinePart('z', set, (obj) => {
        entry.zPart = obj;
        entry.zBaseX = obj.position.x;
        entry.zBaseY = obj.position.y;
        entry.zBaseZ = obj.position.z;
        // 좌표 라벨 기준점 = Z축 헤드 윗면 가운데 (파트 위치 기준 오프셋, 헤드와 함께 이동)
        const zBox = new THREE.Box3().setFromObject(obj);
        const zCenter = zBox.getCenter(new THREE.Vector3());
        entry.zLabelOffset = new THREE.Vector3(zCenter.x, zCenter.y, zBox.max.z).sub(obj.position);
        onAxisPartLoaded(set);
    });
});

// ---------------------------------------------------------------------
// 클릭 — 클릭한 화면을 조작 대상으로 선택하고, 그 화면 카메라 기준으로 좌표 확인
// ---------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const clickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const clickPoint = new THREE.Vector3();
const clickNdc = new THREE.Vector2();

const clickMarker = new THREE.Mesh(
    new THREE.SphereGeometry(CLICK_MARKER_RADIUS, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff33ff })
);
clickMarker.visible = false;
scene.add(clickMarker);

const clickLabel = createTextSprite('#ff99ff');
clickLabel.sprite.visible = false;
scene.add(clickLabel.sprite);

renderer.domElement.addEventListener('click', (e) => {
    if (suppressNextClick) { // 드래그(회전·이동)로 끝난 클릭은 좌표 확인 안 함
        suppressNextClick = false;
        return;
    }
    const view = viewAtPoint(e.clientX, e.clientY);
    activeView = view;
    updateActiveFrame();
    renderMachinePanel();

    const r = getViewRect(view);
    clickNdc.set(
        ((e.clientX - r.x) / r.w) * 2 - 1,
        -((e.clientY - r.y) / r.h) * 2 + 1
    );
    raycaster.setFromCamera(clickNdc, view.camera);
    const hits = raycastTargets.length ? raycaster.intersectObjects(raycastTargets, true) : [];
    if (hits.length) {
        clickPoint.copy(hits[0].point);
    } else if (!raycaster.ray.intersectPlane(clickPlane, clickPoint)) {
        return;
    }

    clickMarker.position.copy(clickPoint);
    clickMarker.visible = true;
    clickLabel.sprite.position.set(clickPoint.x, clickPoint.y, clickPoint.z + 200);
    clickLabel.sprite.visible = true;
    updateTextSprite(clickLabel, `X:${Math.round(clickPoint.x)} Y:${Math.round(clickPoint.y)} Z:${Math.round(clickPoint.z)}`);
});

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    allViews.forEach(updateViewCamera);
});

// ---------------------------------------------------------------------
// 이동/회전 — 선택된 화면(activeView)에만 적용
// ---------------------------------------------------------------------
const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

function updateActiveViewByKeys(dt) {
    const v = activeView;
    const dist = MOVE_SPEED * dt;
    if (keyStates['KeyW']) v.target.y += dist;
    if (keyStates['KeyS']) v.target.y -= dist;
    if (keyStates['KeyA']) v.target.x -= dist;
    if (keyStates['KeyD']) v.target.x += dist;
    if (keyStates['KeyQ']) v.target.z += dist; // 상승
    if (keyStates['KeyE']) v.target.z -= dist; // 하강
    if (keyStates['ArrowLeft']) v.azimuth += ROTATE_SPEED * dt;
    if (keyStates['ArrowRight']) v.azimuth -= ROTATE_SPEED * dt;
    if (keyStates['ArrowUp']) v.elevation = Math.min(ORBIT_ELEVATION_MAX, v.elevation + ROTATE_SPEED * dt);
    if (keyStates['ArrowDown']) v.elevation = Math.max(ORBIT_ELEVATION_MIN, v.elevation - ROTATE_SPEED * dt);
    if (keyStates['KeyZ']) v.viewHeight = Math.max(MIN_VIEW_HEIGHT, v.viewHeight * (1 - ZOOM_SPEED * dt)); // 확대
    if (keyStates['KeyX']) v.viewHeight = v.viewHeight * (1 + ZOOM_SPEED * dt); // 축소
}

// ---------------------------------------------------------------------
// 마우스 드래그 — 누른 화면에 적용 (그 화면이 조작 대상으로 선택됨)
//   왼쪽 버튼 드래그: 회전 (좌우 = 방향, 상하 = 고도)
//   오른쪽·가운데 버튼 드래그 또는 Shift + 왼쪽 드래그: 화면 이동(패닝)
// 조금만 움직이고 뗀 경우(DRAG_THRESHOLD_PX 이하)는 기존처럼 클릭 = 화면 선택·좌표 확인
// ---------------------------------------------------------------------
const MOUSE_ROTATE_SPEED = 0.005; // 라디안/픽셀
const DRAG_THRESHOLD_PX = 4;
let drag = null; // { view, mode: 'rotate' | 'pan', lastX, lastY, startX, startY, moved }
let suppressNextClick = false;
const panRight = new THREE.Vector3();
const panUp = new THREE.Vector3();

renderer.domElement.style.touchAction = 'none';
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('pointerdown', (e) => {
    const view = viewAtPoint(e.clientX, e.clientY);
    const pan = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    drag = { view, mode: pan ? 'pan' : 'rotate', lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
    suppressNextClick = false;
    renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    if (!drag.moved) {
        drag.moved = true;
        // 드래그한 화면을 조작 대상으로 선택
        activeView = drag.view;
        updateActiveFrame();
        renderMachinePanel();
    }
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    const v = drag.view;

    if (drag.mode === 'rotate') {
        v.azimuth -= dx * MOUSE_ROTATE_SPEED;
        v.elevation = Math.min(ORBIT_ELEVATION_MAX, Math.max(ORBIT_ELEVATION_MIN, v.elevation + dy * MOUSE_ROTATE_SPEED));
    } else {
        // 화면 1픽셀 = viewHeight / 화면 높이(px) mm. 카메라 기준 좌우·상하 방향으로 중심점 이동
        const mmPerPx = v.viewHeight / getViewRect(v).h;
        panRight.setFromMatrixColumn(v.camera.matrixWorld, 0);
        panUp.setFromMatrixColumn(v.camera.matrixWorld, 1);
        v.target.addScaledVector(panRight, -dx * mmPerPx);
        v.target.addScaledVector(panUp, dy * mmPerPx);
    }
});

function endDrag(e) {
    if (!drag) return;
    if (drag.moved) suppressNextClick = true;
    if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
    drag = null;
}
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

// 마우스 휠 — 커서가 있는 화면만 확대·축소
window.addEventListener('wheel', (e) => {
    const v = viewAtPoint(e.clientX, e.clientY);
    if (e.deltaY < 0) {
        v.viewHeight = Math.max(MIN_VIEW_HEIGHT, v.viewHeight * (1 - WHEEL_ZOOM_STEP)); // 확대
    } else {
        v.viewHeight = v.viewHeight * (1 + WHEEL_ZOOM_STEP); // 축소
    }
}, { passive: true });

// ---------------------------------------------------------------------
// 루프
// ---------------------------------------------------------------------
const timer = new THREE.Timer();

function animate() {
    timer.update();
    const deltaTime = Math.min(0.05, timer.getDelta());

    updateActiveViewByKeys(deltaTime);
    visibleViews().forEach(updateViewCamera);

    for (const set of VIEW_SETS) {
        const e = axisSets[set];
        // 실제 데이터 수신 중이면 DB 좌표, 아니면 ACTION 켜짐일 때만 임의 이동, 그 외 정지.
        // 전환 직후엔 현재 위치에서 이어서 움직임(튐 없음)
        const mode = dbOnline[set] ? 'db' : actionOn ? 'random' : 'hold';
        if (mode !== e.mode) {
            if (mode === 'db' && dbPos[set]) dbPos[set].current = { ...e.lastPos };
            if (mode === 'random') {
                e.xMover.reset(e.lastPos.x);
                e.yMover.reset(e.lastPos.y);
                e.zMover.reset(e.lastPos.z);
            }
            e.mode = mode;
        }
        let p = e.lastPos;
        if (mode === 'db') p = stepDbPos(set, deltaTime) || e.lastPos;
        else if (mode === 'random') p = { x: e.xMover.update(deltaTime), y: e.yMover.update(deltaTime), z: e.zMover.update(deltaTime) };
        e.lastPos = { x: p.x, y: p.y, z: p.z };
        const xDelta = p.x;
        const yDelta = p.y;
        const zDelta = p.z;
        if (e.yPart) {
            e.yPart.position.y = e.yBaseY + yDelta;
        }
        if (e.xPart) {
            e.xPart.position.x = e.xBaseX + xDelta;
            e.xPart.position.y = e.xBaseY + yDelta;
        }
        if (e.zPart) {
            e.zPart.position.x = e.zBaseX + xDelta;
            e.zPart.position.y = e.zBaseY + yDelta;
            e.zPart.position.z = e.zBaseZ + zDelta;
        }
    }

    // 상단 가운데 HUD — 선택된 화면의 중심점
    if (coordsEl) {
        const p = activeView.target;
        const text = `${viewName(activeView)} 화면 중심  X ${p.x.toFixed(0)}  Y ${p.y.toFixed(0)}  Z ${p.z.toFixed(0)} mm`;
        if (coordsEl.textContent !== text) coordsEl.textContent = text;
    }

    // 화면을 각 구역(viewport)에 렌더링 — 2×2면 4개, 전체 화면이면 1개. WebGL 좌표는 좌하단 원점
    renderer.setScissorTest(true);
    for (const view of visibleViews()) {
        const r = getViewRect(view);
        const glY = window.innerHeight - r.y - r.h;
        renderer.setViewport(r.x, glY, r.w, r.h);
        renderer.setScissor(r.x, glY, r.w, r.h);
        renderer.render(scene, view.camera);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    updateCoordLabels();
}
renderer.setAnimationLoop(animate);
