import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

// RectAreaLight 초기화
RectAreaLightUniformsLib.init();

// 장면 설정
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

// 카메라 설정 (Isometric)
const aspect = window.innerWidth / window.innerHeight;
const viewSize = 500;
const camera = new THREE.OrthographicCamera(
  -viewSize * aspect, viewSize * aspect,
  viewSize, -viewSize,
  0.1, 100000
);
camera.position.set(500, 500, 500);
camera.lookAt(0, 0, 0);

// 렌더러 설정
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// 마우스로 돌리기 설정
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// 1_light : 외부 하늘 고정 조명
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.position.set(500, 1000, 500);
scene.add(sunLight);

// 2_light : 실내 천장 조명
const rectLight = new THREE.RectAreaLight(0xffffff, 5, 1000, 1000);
rectLight.position.set(0, 900, 0);
rectLight.lookAt(0, 0, 0);
rectLight.visible = false;
scene.add(rectLight);

// 보조 조명
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

// GLB 로더
const gltfLoader = new GLTFLoader();
gltfLoader.load('/models/factory.glb', function(gltf) {
    const object = gltf.scene;
    object.traverse(function(child) {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    scene.add(object);
});

// OBJ 로더
const mtlLoader = new MTLLoader();
const objLoader = new OBJLoader();

// one-room3 로드
// mtlLoader.load('/models/one-room3.mtl', function(materials) {
//     materials.preload();
//     objLoader.setMaterials(materials);
//     objLoader.load('/models/one-room3.obj', function(object) {
//         object.traverse(function(child) {
//             if (child.isMesh) {
//                 child.castShadow = true;
//                 child.receiveShadow = true;
//                 child.material.side = THREE.DoubleSide;
//             }
//         });
//         const box = new THREE.Box3().setFromObject(object);
//         const center = box.getCenter(new THREE.Vector3());
//         object.position.sub(center);
//         scene.add(object);
//     });
// });

// one-room4 로드
// mtlLoader.load('/models/one-room4.mtl', function(materials) {
//     materials.preload();
//     objLoader.setMaterials(materials);
//     objLoader.load('/models/one-room4.obj', function(object) {
//         object.traverse(function(child) {
//             if (child.isMesh) {
//                 child.castShadow = true;
//                 child.receiveShadow = true;
//                 child.material.side = THREE.DoubleSide;
//             }
//         });
//         const box = new THREE.Box3().setFromObject(object);
//         const center = box.getCenter(new THREE.Vector3());
//         object.position.sub(center);
//         scene.add(object);
//     });
// });

// 조명 버튼 제어
const btnSun = document.getElementById('btn-sun');
const btnIndoor = document.getElementById('btn-indoor');

btnSun.addEventListener('click', () => {
    sunLight.visible = !sunLight.visible;
    btnSun.textContent = sunLight.visible ? '☀️ 외부 조명 ON' : '☀️ 외부 조명 OFF';
    btnSun.classList.toggle('active', sunLight.visible);
});

btnIndoor.addEventListener('click', () => {
    rectLight.visible = !rectLight.visible;
    btnIndoor.textContent = rectLight.visible ? '💡 실내 조명 ON' : '💡 실내 조명 OFF';
    btnIndoor.classList.toggle('active', rectLight.visible);
});

// 밝기 슬라이더 제어
const sliderSun = document.getElementById('slider-sun');
const sliderIndoor = document.getElementById('slider-indoor');
const sunValue = document.getElementById('sun-value');
const indoorValue = document.getElementById('indoor-value');

sliderSun.addEventListener('input', () => {
    sunLight.intensity = parseFloat(sliderSun.value);
    sunValue.textContent = sliderSun.value;
});

sliderIndoor.addEventListener('input', () => {
    rectLight.intensity = parseFloat(sliderIndoor.value);
    indoorValue.textContent = sliderIndoor.value;
});

// View Cube 제어
const views = {
    iso:     { pos: [500, 500, 500],   up: [0,1,0] },
    top:     { pos: [0, 1000, 0],      up: [0,0,-1] },
    front:   { pos: [0, 0, 1000],      up: [0,1,0] },
    back:    { pos: [0, 0, -1000],     up: [0,1,0] },
    right:   { pos: [1000, 0, 0],      up: [0,1,0] },
    left:    { pos: [-1000, 0, 0],     up: [0,1,0] },
    bottom:  { pos: [0, -1000, 0],     up: [0,0,1] },
    'x-pos': { pos: [1000, 0, 0],      up: [0,1,0] },
    'x-neg': { pos: [-1000, 0, 0],     up: [0,1,0] },
    'y-pos': { pos: [0, 1000, 0],      up: [0,0,-1] },
    'y-neg': { pos: [0, -1000, 0],     up: [0,0,1] },
    'z-pos': { pos: [0, 0, 1000],      up: [0,1,0] },
    'z-neg': { pos: [0, 0, -1000],     up: [0,1,0] },
};

document.querySelectorAll('.cube-face').forEach(btn => {
    btn.addEventListener('click', () => {
        const view = views[btn.dataset.view];
        camera.position.set(...view.pos);
        camera.up.set(...view.up);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();
        document.querySelectorAll('.cube-face').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// 화면 크기 변경 대응
window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -viewSize * aspect;
    camera.right = viewSize * aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 애니메이션 루프
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();