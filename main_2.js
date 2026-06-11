import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 장면 설정
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);


// 카메라 설정 (Isometric)
const aspect = window.innerWidth / window.innerHeight;
const viewSize = 500;
const camera = new THREE.OrthographicCamera(
  -viewSize * aspect, viewSize * aspect,
  viewSize, -viewSize,
  0.1, 10000
);
camera.position.set(500, 500, 500);
camera.lookAt(0, 0, 0);




// 카메라 설정 #1
// const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
// camera.position.set(0, 750, 1000);

// 렌더러 설정
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 마우스로 돌리기 설정
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// 1_light : 외부 하늘 고정 조명
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.position.set(500, 1000, 500);
scene.add(sunLight);

// 2_light : 실내 천장 조명 (기본은 꺼져있음)
const rectLight = new THREE.RectAreaLight(0xffffff, 5, 1000, 1000);
rectLight.position.set(0, 900, 0);
rectLight.lookAt(0, 0, 0);
scene.add(rectLight);

// 보조 조명 (너무 어두운 면 보완)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);



// OBJ 모델 불러오기
const mtlLoader = new MTLLoader();
mtlLoader.load('/models/one-room4.mtl', function(materials) {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('/models/one-room4.obj', function(object) {
    object.traverse(function(child) {
        if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                roughness: 0.8,
                metalness: 0.1,
                side: THREE.DoubleSide
            });
        }
    });
    scene.add(object);
});
});

// 화면 크기 변경 대응
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});


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



// 애니메이션 루프
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();