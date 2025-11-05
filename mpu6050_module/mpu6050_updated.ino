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

// Calibration flags
bool stillCalibrated = false;
bool StartSignal = false;

// WebSocket event handler
void webSocketEvent(uint8_t client_num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    String msg = String((char*)payload);

    if (msg == "start") {
      StartSignal = true;
      Serial.println("==== STEP 1: STILL CALIBRATION ====");
      Serial.println("Place sensor flat and still (not worn).");
    } 
    else if (msg == "stop") {
      StartSignal = false;
      Serial.println("Streaming stopped.");
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


  // STEP 1: Still calibration (only once after start)
  if (StartSignal && !stillCalibrated) {
    mpu68.CalibrateAccel(6);
    mpu68.CalibrateGyro(6);
    stillCalibrated = true;
    Serial.println("Still calibration complete.");
    String payload = "{\"msg\": \"Still\"}";
    webSocket.broadcastTXT(payload);
  }

  // STEP 2: Stream raw quaternions (no calibration correction)
  if (StartSignal && stillCalibrated) {
    if (millis() - lastSend >= sendInterval) {
      lastSend = millis();
      recordCount++;
      uint8_t fifoBuffer[64];
      if (!mpu68.dmpGetCurrentFIFOPacket(fifoBuffer)) return;

      Quaternion qNow;
      mpu68.dmpGetQuaternion(&qNow, fifoBuffer);
      
      String payload = "{\"count\": " + String(recordCount) +
                       ", \"label\": \"LA\", " +
                       "\"quaternion\": [" +
                       String(qNow.w, 4) + ", " +
                       String(qNow.x, 4) + ", " +
                       String(qNow.y, 4) + ", " +
                       String(qNow.z, 4) + "] }";

      Serial.println(payload);
      webSocket.broadcastTXT(payload);
    }
  }
}
