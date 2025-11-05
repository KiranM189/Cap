import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader';

// =============================
//  Scene, Camera & Renderer
// =============================
const scene = new THREE.Scene();

new RGBELoader().load('/textures/park_parking_4k.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
});

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
const container = document.getElementById("Container");
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

camera.aspect = container.clientWidth / container.clientHeight;
camera.updateProjectionMatrix();

// =============================
// 💡 Lighting
// =============================
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5);
scene.add(light);

// =============================
// 🦴 Model Loading
// =============================
const boneMap = {};
const labelToBoneName = {
    RFA: "mixamorigRightForeArm",
    RA: "mixamorigRightArm",
    LA: "mixamorigLeftArm",
    LFA: "mixamorigLeftForeArm",
    LUL: "mixamorigLeftUpLeg",
    LL: "mixamorigLeftLeg",
    RUL: "mixamorigRightUpLeg",
    RL: "mixamorigRightLeg",
    SP: "mixamorigSpine",
    SP1: "mixamorigSpine1",
    SP2: "mixamorigSpine2",
    H: "mixamorigHead",
};

let model;
new GLTFLoader().load('/ybot.gltf', (gltf) => {
    model = gltf.scene;

    model.traverse((child) => {
        if (child.isBone) {
            // const axes = new THREE.AxesHelper(20); // adjust size as needed
            // child.add(axes);
            for (const [label, boneName] of Object.entries(labelToBoneName)) {
                if (child.name === boneName) {
                    boneMap[label] = child;
                    console.log(`✅ Mapped label ${label} to bone ${boneName}`);
                }
            }
        }
    });

    model.scale.set(2, 2, 2);
    scene.add(model);
    console.log("✅ Model added to scene");
});

// =============================
//  WebSocket Management
// =============================
const sensorSockets = {
    LFA:"10.148.16.225",
    // RFA:"10.148.16.203",
    LA:"10.148.16.203",
    // RA:"10.148.16.85",
};

const sockets = {};
const connected = [];
let count = 0;

function connectSensor(label, ip) {
    const ws = new WebSocket(`ws://${ip}:81`);

    ws.onopen = () => {
        connected.push(label);
        sockets[label] = ws;
        console.log(`✅ Connected to sensor: ${label}`);
        count += 1;
    };

    ws.onerror = (err) => console.error(`❌ WebSocket error (${label}):`, err);

    ws.onmessage = (event) => handleSensorMessage(label, event);
}

// =============================
// 🧭 Calibration Logic (Client-side)
// =============================
const calibrationData = {};
const qRef = {};
let isCalibrating = false,calibrated = false;
const CALIBRATION_DURATION = 30000; // 30 seconds
var calibrationStartTime = 0;

function normalizeQuat(q) {
    const len = Math.hypot(q.w, q.x, q.y, q.z);
    return len > 0 ? { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len } : q;
}

function startCalibration() {
    isCalibrating = true;
    calibrationStartTime = performance.now();
    for (const label of connected) {
        calibrationData[label] = [];
    }

    console.log("🟡 Collecting T-Pose samples for 30 seconds...");
    let countdown = 30;
    const interval = setInterval(() => {
        console.log(`⏳ ${countdown--}s remaining...`);
    }, 1000);

    setTimeout(() => {
        clearInterval(interval);
        finishCalibration();
    }, CALIBRATION_DURATION);
}

function finishCalibration() {
    console.log("🟢 T-Pose calibration done!");
    for (const label of connected) {
        const samples = calibrationData[label];
        if (samples && samples.length > 0) {
            let sum = { w: 0, x: 0, y: 0, z: 0 };
            for (const q of samples) {
                sum.w += q.w;
                sum.x += q.x;
                sum.y += q.y;
                sum.z += q.z;
            }
            const avg = {
                w: sum.w / samples.length,
                x: sum.x / samples.length,
                y: sum.y / samples.length,
                z: sum.z / samples.length
            };
            qRef[label] = normalizeQuat(avg);
            console.log(`✅ ${label} reference quaternion:`, qRef[label]);
        }
    }
    isCalibrating = false;
    calibrated = true;
    alert("✅ T-Pose calibration completed!");
}

function applyCalibration(label, qNow) {
    const ref = qRef[label];
    if (!ref) return qNow;

    const conjugate = new THREE.Quaternion(-ref.x, -ref.y, -ref.z, ref.w);
    const qRelative = new THREE.Quaternion().copy(conjugate).multiply(qNow);
    qRelative.normalize();
    return qRelative;
}

// =============================
//  Message Handling
// =============================
function handleSensorMessage(label, event) {
    try {
        const data = JSON.parse(event.data);

        // Ignore messages without quaternion data
        if (!Array.isArray(data.quaternion) || data.quaternion.length !== 4) return;

        const bone = boneMap[data.label];
        if (!bone) {
            console.warn(`⚠️ Bone not found for label: ${data.label}`);
            return;
        }

        const [w, x, y, z] = data.quaternion;
        const q = new THREE.Quaternion(x, y, z, w);

        if (isCalibrating) {
            if (calibrationData[label]) {
                calibrationData[label].push({ w, x, y, z });
            }
            return;
        }
        
        if(calibrated) {
            const calibratedQ = applyCalibration(label, q);
            bone.quaternion.copy(calibratedQ); // Smooth blend  
        }
        

    } catch (err) {
        console.error(`❌ Failed to parse message for ${label}:`, err);
    }
}

// =============================
//  Button Event Handlers
// =============================
const btn1 = document.getElementById("btn1");
const btn2 = document.getElementById("btn2");
const btn3 = document.getElementById("btn3");

btn1.onclick = () => {
    for (const [label, ip] of Object.entries(sensorSockets)) {
        connectSensor(label, ip);
    }
};

btn2.onclick = () => {
    for (const label of connected) {
        const ws = sockets[label];
        if (ws?.readyState === WebSocket.OPEN) ws.send("start");
    }
};

btn3.onclick = () => {
    // Tell all sensors to start streaming (they don’t average anymore)
    for (const label of connected) {
        const ws = sockets[label];
        if (ws?.readyState === WebSocket.OPEN) ws.send("calibrate");
    }
    startCalibration();
};

// =============================
//  Controls & Render Loop
// =============================
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// =============================
//  Responsive Resize
// =============================
window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
});
