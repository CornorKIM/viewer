import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88ccee);

// FPS 카메라
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100000);
camera.rotation.order = 'YXZ';
camera.position.set(0, 100, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

// 조명
const ambientLight = new THREE.AmbientLight(0xffffff, 3);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 3);
dirLight1.position.set(0, 1000, 0);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xffffff, 2);
dirLight2.position.set(0, 500, 1000);
scene.add(dirLight2);

const dirLight3 = new THREE.DirectionalLight(0xffffff, 2);
dirLight3.position.set(1000, 500, 0);
scene.add(dirLight3);

// GLB 로드
const loader = new GLTFLoader();
loader.load('/models/factory.glb', (gltf) => {
    const object = gltf.scene;
    object.rotation.x = Math.PI / 2;
    object.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.5,
                metalness: 0.1,
                side: THREE.DoubleSide
            });
        }
    });
    scene.add(object);

    // 카메라 시작 위치
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    camera.position.set(center.x, center.y + size.y * 0.1, center.z);
    console.log('모델 로드 완료!');
});

// 키보드
const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// 마우스 클릭시 포인터 잠금
document.body.addEventListener('click', () => {
    document.body.requestPointerLock();
});

document.body.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        camera.rotation.y -= e.movementX / 500;
        camera.rotation.x -= e.movementY / 500;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 이동
const moveSpeed = 50;
const direction = new THREE.Vector3();
const front = new THREE.Vector3();
const right = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    if (document.pointerLockElement === document.body) {
        camera.getWorldDirection(front);
        front.y = 0;
        front.normalize();

        right.crossVectors(front, new THREE.Vector3(0, 1, 0)).normalize();

        direction.set(0, 0, 0);

        if (keyStates['KeyW']) direction.add(front);
        if (keyStates['KeyS']) direction.sub(front);
        if (keyStates['KeyA']) direction.sub(right);
        if (keyStates['KeyD']) direction.add(right);
        if (keyStates['KeyE']) direction.y += 1;
        if (keyStates['KeyQ']) direction.y -= 1;

        direction.normalize().multiplyScalar(moveSpeed * 0.1);
        camera.position.add(direction);
    }

    renderer.render(scene, camera);
}
animate();