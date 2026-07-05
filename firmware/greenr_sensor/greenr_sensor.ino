/*  greenr sensor — ESP32-C3 Super Mini  (v2: captive-portal WiFi)
 *
 *  Setup for the end user is now: plug in → phone joins the "greenr-setup"
 *  WiFi hotspot → pick home WiFi on the page that appears → done. No code, no
 *  computer. The WiFi is remembered across deep sleep.
 *
 *  Reads light (LDR), soil (capacitive), temp/humidity (DHT11), keeps a running
 *  Daily Light Integral, uploads to Supabase, deep-sleeps. The server controls
 *  the sleep interval and can request an immediate reading (app "read now").
 *
 *  LIBRARIES (Arduino IDE → Library Manager):
 *    - "WiFiManager" by tzapu
 *    - "DHT sensor library" by Adafruit (+ "Adafruit Unified Sensor")
 *  Board: "ESP32C3 Dev Module".
 *
 *  WIRING (ESP32-C3 Super Mini):
 *    LDR AO -> GPIO0 | Soil AO -> GPIO1 | DHT11 DATA -> GPIO3
 *    All sensor VCC -> GPIO10 (switched power) | All GND -> GND
 *
 *  DEVICE_ID / DEVICE_KEY: these are unique per unit. The provisioning tool
 *  (scripts/provision-device.mjs) prints the two lines to paste here before you
 *  flash each board, and generates that unit's QR sticker + registers it.
 */

#include <WiFiManager.h>          // tzapu
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <time.h>

// ---------- PER-DEVICE IDENTITY (from the provisioning tool) ----------
// (Defaults below are your first test device so you can try it immediately.)
#define DEVICE_ID   "2b56a6e1-9d4f-4ed0-87fc-b304ae8dcf6d"
#define DEVICE_KEY  "98e818906a47d8b0901c7a4864f061be"
// ----------------------------------------------------------------------

// Soil / light calibration (adjust after watching Serial Monitor):
int SOIL_AIR = 3000, SOIL_WATER = 1300;
int LIGHT_DARK = 200, LIGHT_BRIGHT = 3200;

const char* SUPABASE_URL =
  "https://knyymwvrqitptfzckyvf.supabase.co/rest/v1/rpc/ingest_reading";
const char* SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtueXltd3ZycWl0cHRmemNreXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMjU5NDMsImV4cCI6MjA5ODgwMTk0M30.yPwANlvW6i_F8fnSuAfaCyGccXIJo2Pny83I7tRYtf0";

#define LDR_PIN 0
#define SOIL_PIN 1
#define DHT_PIN 3
#define SENSOR_PWR 10        // set to -1 if powering sensors from 3V3
#define DHTTYPE DHT11

DHT dht(DHT_PIN, DHTTYPE);

RTC_DATA_ATTR float dliAccum = 0;
RTC_DATA_ATTR int   dayOfYear = -1;
RTC_DATA_ATTR int   wakeSeconds = 1800;

int clampPct(long v){ return v<0?0:(v>100?100:(int)v); }

void goToSleep(int s){
  if (SENSOR_PWR >= 0) digitalWrite(SENSOR_PWR, LOW);
  Serial.printf("Sleeping %d s\n", s); Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)s * 1000000ULL);
  esp_deep_sleep_start();
}

void setup(){
  Serial.begin(115200); delay(50);

  // --- WiFi via captive portal ---------------------------------------------
  // First boot with no saved WiFi: opens the "greenr-setup" hotspot for the
  // user to pick their network. Later boots reconnect automatically.
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);          // give up after 3 min, sleep, retry
  if (!wm.autoConnect("greenr-setup")) {
    Serial.println("No WiFi configured yet — sleeping, will reopen setup.");
    goToSleep(300);                        // retry setup in 5 min
  }

  // --- power + read sensors ------------------------------------------------
  if (SENSOR_PWR >= 0){ pinMode(SENSOR_PWR, OUTPUT); digitalWrite(SENSOR_PWR, HIGH); }
  dht.begin(); delay(1200);

  int rawLight = analogRead(LDR_PIN);
  int rawSoil  = analogRead(SOIL_PIN);
  float tempC  = dht.readTemperature();
  float hum    = dht.readHumidity();
  if (isnan(tempC)) tempC = 0;
  if (isnan(hum))   hum   = 0;
  Serial.printf("raw light=%d  raw soil=%d  temp=%.1f  hum=%.1f\n", rawLight, rawSoil, tempC, hum);

  int soilPct = clampPct(map(rawSoil, SOIL_AIR, SOIL_WATER, 0, 100));
  float lightFrac = (float)(rawLight - LIGHT_DARK) / (float)(LIGHT_BRIGHT - LIGHT_DARK);
  if (lightFrac < 0) lightFrac = 0; if (lightFrac > 1) lightFrac = 1;
  int lightIdx = (int)(lightFrac * 100);
  dliAccum += (lightFrac * 2000.0) * (float)wakeSeconds / 1000000.0;  // rough DLI
  int batteryPct = -1;

  // --- upload --------------------------------------------------------------
  configTime(0,0,"pool.ntp.org");
  struct tm ti;
  if (getLocalTime(&ti, 3000)){ if (ti.tm_yday != dayOfYear){ dayOfYear = ti.tm_yday; dliAccum = 0; } }

  String body = "{";
  body += "\"p_device\":\"" DEVICE_ID "\",";
  body += "\"p_secret\":\"" DEVICE_KEY "\",";
  body += "\"p_light\":" + String(lightIdx) + ",";
  body += "\"p_dli\":" + String(dliAccum,3) + ",";
  body += "\"p_soil\":" + String(soilPct) + ",";
  body += "\"p_temp\":" + String(tempC,1) + ",";
  body += "\"p_humidity\":" + String(hum,1) + ",";
  body += "\"p_battery\":" + String(batteryPct) + "}";

  WiFiClientSecure client; client.setInsecure();
  HTTPClient https;
  if (https.begin(client, SUPABASE_URL)){
    https.addHeader("Content-Type","application/json");
    https.addHeader("apikey", SUPABASE_ANON);
    https.addHeader("Authorization", String("Bearer ")+SUPABASE_ANON);
    int code = https.POST(body);
    String resp = https.getString();
    Serial.printf("POST %d: %s\n", code, resp.c_str());
    int wi = resp.indexOf("wake_seconds");
    if (wi >= 0){ int c = resp.indexOf(':', wi); wakeSeconds = resp.substring(c+1).toInt(); if (wakeSeconds < 60) wakeSeconds = 1800; }
    https.end();
  }

  goToSleep(wakeSeconds);
}

void loop(){}
