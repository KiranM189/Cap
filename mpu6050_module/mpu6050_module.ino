#include <WebSockets.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include "Wire.h"
#include "MPU6050_6Axis_MotionApps612.h"

// WiFi credentials
const char* ssid = "OPPO K13x 5G b44i";
const char* password = "grqr7863";

// WebSocket server
WebSocketsServer webSocket(81);

// MPU6050
MPU6050 mpu68;
bool dmpReady = false;

// Timing
unsigned long lastSend = 0;
const unsigned long sendInterval = 30;
unsigned long recordCount = 0;

// Calibration
Quaternion qRef(1, 0, 0, 0);
Quaternion qSum(0, 0, 0, 0);
bool stillCalibrated = false;
bool tPoseCalibrated = false;
bool collecting = false;
bool StartSignal = false;
unsigned long calibrationStartTime = 0;
int calibrationSamples = 0;

// Quaternion helpers
Quaternion multiplyQuaternions(Quaternion q1, Quaternion q2) {
  return {
    q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
    q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
    q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
    q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w
  };
}

Quaternion normalizeQuat(Quaternion q) {
  float mag = sqrt(q.w*q.w + q.x*q.x + q.y*q.y + q.z*q.z);
  if (mag > 0) {
    q.w /= mag; q.x /= mag; q.y /= mag; q.z /= mag;
  }
  return q;
}

Quaternion conjugateQuat(Quaternion q) {
  return { q.w, -q.x, -q.y, -q.z };
}

// WebSocket event handler
void webSocketEvent(uint8_t client_num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    String msg = String((char*)payload);

    if (msg == "start") {
      StartSignal = true;
      Serial.println("==== STEP 1: STILL CALIBRATION ====");
      Serial.println("Place sensor flat and still (not worn).");
    } 
    else if (msg == "calibrate") {
      collecting = true;
      calibrationStartTime = millis();
      calibrationSamples = 0;
      qSum = {0, 0, 0, 0};
      Serial.println("==== STEP 2: T-POSE CALIBRATION ====");
      Serial.println("Wear sensor and hold T-pose for 30 seconds...");
    }
    else if (msg == "stop") {
      StartSignal = false;
    }
    
    Serial.printf("Received from %u: %s\n", client_num, payload);
  }
}

void setup() {
  Wire.begin(8, 9);
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(100);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server started on port 81");

  mpu68.initialize();
  if (!mpu68.testConnection()) {
    Serial.println("MPU6050 connection failed");
    while (1);
  }

  if (mpu68.dmpInitialize() != 0) {
    Serial.println("DMP init failed");
    while (1);
  }

  mpu68.setDMPEnabled(true);
  dmpReady = true;
  delay(1000);
}

void loop() {
  webSocket.loop();
  if (!dmpReady) return;

  uint8_t fifoBuffer[64];
  if (!mpu68.dmpGetCurrentFIFOPacket(fifoBuffer)) return;

  Quaternion qNow;
  mpu68.dmpGetQuaternion(&qNow, fifoBuffer);

  // STEP 1: Still calibration (only once after start)
  if (StartSignal && !stillCalibrated) {
    mpu68.CalibrateAccel(6);
    mpu68.CalibrateGyro(6);
    stillCalibrated = true;
    Serial.println("Still calibration complete.");
    String payload = "{\"msg\": \"Still\"}";
    webSocket.broadcastTXT(payload);
  }

  // STEP 2: T-pose calibration
  if (collecting) {
    unsigned long elapsed = millis() - calibrationStartTime;

    // Accumulate samples for average quaternion
    qSum.w += qNow.w;
    qSum.x += qNow.x;
    qSum.y += qNow.y;
    qSum.z += qNow.z;
    calibrationSamples++;

    if (elapsed % 5000 < 30) {
      Serial.printf("T-pose calibration: %lus remaining...\n", 30 - elapsed / 1000);
    }

    if (elapsed >= 30000) {
      collecting = false;
      tPoseCalibrated = true;

      qRef.w = qSum.w / calibrationSamples;
      qRef.x = qSum.x / calibrationSamples;
      qRef.y = qSum.y / calibrationSamples;
      qRef.z = qSum.z / calibrationSamples;
      qRef = normalizeQuat(qRef);

      Serial.println("T-pose calibration done.");
      Serial.println("Streaming quaternions...");
      String payload = "{\"msg\": \"T-Pose\"}";
      webSocket.broadcastTXT(payload);
    }
    return;
  }

  // STEP 3: Normal streaming after calibration
  if (stillCalibrated && tPoseCalibrated && StartSignal) {
    if (millis() - lastSend >= sendInterval) {
      lastSend = millis();
      recordCount++;

      Quaternion qRelative = multiplyQuaternions(conjugateQuat(qRef), qNow);
      qRelative = normalizeQuat(qRelative);

      String payload = "{\"count\": " + String(recordCount) +
                       ", \"label\": \"LA\", " +
                       "\"quaternion\": [" +
                       String(qRelative.w, 4) + ", " +
                       String(qRelative.x, 4) + ", " +
                       String(qRelative.y, 4) + ", " +
                       String(qRelative.z, 4) + "]}";

      Serial.println(payload);
      webSocket.broadcastTXT(payload);
    }
  }
}
