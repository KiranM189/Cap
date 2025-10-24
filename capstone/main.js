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
        // const axesHelper = new THREE.AxesHelper(1);
        // model.add(axesHelper);
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
    RFA: "10.148.16.90",
    RA: "10.148.16.85",
    // RFA: "192.168.103.225",
    // LA: "192.168.103.178",
    // LFA: "192.168.103.203",
    // RUL: "192.168.103.85",
    // RL: "192.168.103.203",
    // SP1: "192.168.103.84",
};

const sockets = {};
const connected = [];
var count = 0;
function connectSensor(label, ip) {
    const ws = new WebSocket(`ws://${ip}:81`);

    ws.onopen = () => {
        connected.push(label);
        sockets[label] = ws;
        console.log(`✅ Connected to sensor: ${label}`);
        count +=1;
    };

    ws.onerror = (err) => console.error(`❌ WebSocket error (${label}):`);

    // ws.onclose = () => {
    //     console.warn(`⚠️ ${label} disconnected. Reconnecting in 3s...`);
    //     setTimeout(() => connectSensor(label, ip), 3000);
    // };

    ws.onmessage = (event) => handleSensorMessage(label, event);
}

function handleSensorMessage(label, event) {
    var lcount = 0, lt_count = 0;
    try {
        const data = JSON.parse(event.data);

        // Alerts for calibration messages
        if (data.msg) {
            if (data.msg === "Still") {
                lcount += 1;
                if(lcount == count){
                    alert("✅ Still calibration completed");
                }
            } else if (data.msg === "T-Pose") {
                lt_count += 1;
                if(lt_count == count){
                    alert("✅ T-Pose calibration completed");
                }
            }
            return;
        }
        // Validate quaternion data
        if (!Array.isArray(data.quaternion) || data.quaternion.length !== 4) return;

        const bone = boneMap[data.label];
        if (!bone) {
            console.warn(`⚠️ Bone not found for label: ${data.label}`);
            return;
        }

        const [w, x, y, z] = data.quaternion;
        const q = new THREE.Quaternion(x, y, z, w);
        bone.quaternion.copy(q); // Smooth blend

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
    for (const label of connected) {
        const ws = sockets[label];
        if (ws?.readyState === WebSocket.OPEN) ws.send("calibrate");
    }
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
