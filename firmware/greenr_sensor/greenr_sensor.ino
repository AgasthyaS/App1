/*  greenr sensor — ESP32-C3 Super Mini  (v2: captive-portal WiFi)
 *
 *  Setup for the end user is now: plug in → phone joins the "greenr-setup"
 *  WiFi hotspot → pick home WiFi on the page that appears → done. No code, no
 *  computer. The WiFi is remembered across deep sleep.
 *
 *  Reads light (LDR), soil (capacitive), temp/humidity (AHT10 on the C3 build,
 *  DHT22 on the legacy dev kit), keeps a running Daily Light Integral, uploads
 *  to Supabase, deep-sleeps. The server controls the sleep interval and can
 *  request an immediate reading (app "read now").
 *
 *  LIBRARIES (Arduino IDE → Library Manager):
 *    - "WiFiManager" by tzapu
 *    - "Adafruit AHTX0" (+ "Adafruit BusIO", "Adafruit Unified Sensor")  [C3 build]
 *    - "DHT sensor library" by Adafruit                                  [legacy dev-kit build]
 *  Board: "ESP32C3 Dev Module".
 *
 *  WIRING (ESP32-C3 Super Mini):
 *    LDR AO -> GPIO0 | Soil AOUT -> GPIO1 | AHT10 SDA -> GPIO4, SCL -> GPIO5
 *    All sensor VCC -> GPIO10 (switched power) | All GND -> GND
 *
 *  DEVICE_ID / DEVICE_KEY: these are unique per unit. The provisioning tool
 *  (scripts/provision-device.mjs) prints the two lines to paste here before you
 *  flash each board, and generates that unit's QR sticker + registers it.
 */

#include <WiFiManager.h>          // tzapu
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  // C3 build: AHT10 temp/humidity over I2C.
  // Library Manager → install "Adafruit AHTX0" (+ its "Adafruit BusIO" dep).
  #include <Wire.h>
  #include <Adafruit_AHTX0.h>
#else
  #include <DHT.h>
#endif

// ---------- PER-DEVICE IDENTITY (from the provisioning tool) ----------
// THIS BUILD = the ORIGINAL ESP32 dev-kit unit (DHT22). Board = "ESP32 Dev
// Module" → the #else pin set + DHT22 are selected automatically below.
// (The C3+AHT10 unit is 1b9345cb-5b4c-41de-a137-1e8f46b3f022 / key
//  2b442b85c5491c5164519937d1d051c2 — paste that back if you flash the C3.)
#define DEVICE_ID   "ae2da43d-781a-40f7-a3ca-45e5570f5d81"
#define DEVICE_KEY  "b7b1da534f47fef89ebd1f182fef646c"
// ----------------------------------------------------------------------

// Soil / light calibration (adjust after watching Serial Monitor):
// SOIL_AIR = raw value when DRY (must be a bit ABOVE your dry reading so dry
// lands near 0%). SOIL_WATER = raw value when the probe sits in water.
int SOIL_AIR = 3150, SOIL_WATER = 1400;

// LIGHT: raw ADC at DARK vs BRIGHT. Defaults assume a normal LDR (dark = low
// raw). If YOUR module is reversed (reads HIGH in the dark), the easiest fix is
// in the app — Devices → Calibrate → "Reversed light sensor" — which flips it
// everywhere without a reflash. (Alternatively swap these two numbers, but then
// leave that in-app switch OFF so it isn't flipped twice.)
int LIGHT_DARK = 200, LIGHT_BRIGHT = 3200;

const char* SUPABASE_URL =
  "https://knyymwvrqitptfzckyvf.supabase.co/rest/v1/rpc/ingest_reading";
const char* SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtueXltd3ZycWl0cHRmemNreXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMjU5NDMsImV4cCI6MjA5ODgwMTk0M30.yPwANlvW6i_F8fnSuAfaCyGccXIJo2Pny83I7tRYtf0";

// Pins differ by board. The right set is picked automatically from the board
// you select in Arduino IDE (Tools → Board).
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  // ESP32-C3 Super Mini: LDR + soil are analog; AHT10 rides the I2C bus.
  #define LDR_PIN    0
  #define SOIL_PIN   1
  #define AHT_SDA    4    // AHT10 SDA
  #define AHT_SCL    5    // AHT10 SCL
  #define SENSOR_PWR 10
  Adafruit_AHTX0 aht;
  bool ahtOk = false;
#else
  // Original ESP32 dev kit — matches the soldered wiring:
  #define LDR_PIN    34   // light sensor AO   (light VCC on 3V3)
  #define SOIL_PIN   39   // soil AOUT (the "VN" pin = GPIO39)
  #define DHT_PIN    18   // DHT22 Out         (DHT VCC on 3V3)
  #define SENSOR_PWR 19   // soil VCC -> GPIO19: code powers the soil sensor here
  #define DHTTYPE    DHT22
  DHT dht(DHT_PIN, DHTTYPE);
#endif

// Temp (°C) + relative humidity (%), from whichever climate sensor this build
// carries. Returns NAN on failure; caller decides what to send.
void readClimate(float* tempC, float* hum){
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  *tempC = NAN; *hum = NAN;
  if (ahtOk){
    sensors_event_t h, t;
    if (aht.getEvent(&h, &t)){ *tempC = t.temperature; *hum = h.relative_humidity; }
  }
#else
  *tempC = dht.readTemperature();
  *hum   = dht.readHumidity();
#endif
}

RTC_DATA_ATTR float dliAccum = 0;
RTC_DATA_ATTR int   dayOfYear = -1;
RTC_DATA_ATTR int   wakeSeconds = 10800;  // 3 h between reports when idle (server can override)

int clampPct(long v){ return v<0?0:(v>100?100:(int)v); }

void goToSleep(int s){
  if (SENSOR_PWR >= 0) digitalWrite(SENSOR_PWR, LOW);
  Serial.printf("Sleeping %d s\n", s); Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)s * 1000000ULL);
  esp_deep_sleep_start();
}

// Read all sensors once and upload. Updates wakeSeconds from the server reply
// (the app sets it small for live mode, large for idle/deep-sleep).
void readAndUpload(){
  int rawLight = analogRead(LDR_PIN);
  int rawSoil  = analogRead(SOIL_PIN);
  float tempC, hum;
  readClimate(&tempC, &hum);
  if (isnan(tempC)) tempC = 0;
  if (isnan(hum))   hum   = 0;
  Serial.printf("raw light=%d  raw soil=%d  temp=%.1f  hum=%.1f\n", rawLight, rawSoil, tempC, hum);

  int soilPct = clampPct(map(rawSoil, SOIL_AIR, SOIL_WATER, 0, 100));
  float lightFrac = (float)(rawLight - LIGHT_DARK) / (float)(LIGHT_BRIGHT - LIGHT_DARK);
  if (lightFrac < 0) lightFrac = 0; if (lightFrac > 1) lightFrac = 1;
  int lightIdx = (int)(lightFrac * 100);
  dliAccum += (lightFrac * 2000.0) * (float)wakeSeconds / 1000000.0;  // rough DLI

  struct tm ti;
  if (getLocalTime(&ti, 1500)){ if (ti.tm_yday != dayOfYear){ dayOfYear = ti.tm_yday; dliAccum = 0; } }

  String body = "{";
  body += "\"p_device\":\"" DEVICE_ID "\",";
  body += "\"p_secret\":\"" DEVICE_KEY "\",";
  body += "\"p_light\":" + String(lightIdx) + ",";
  body += "\"p_dli\":" + String(dliAccum,3) + ",";
  body += "\"p_soil\":" + String(soilPct) + ",";
  body += "\"p_temp\":" + String(tempC,1) + ",";
  body += "\"p_humidity\":" + String(hum,1) + ",";
  body += "\"p_battery\":-1}";

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
    if (wi >= 0){ int c = resp.indexOf(':', wi); wakeSeconds = resp.substring(c + 1).toInt(); }
    if (wakeSeconds < 5 || wakeSeconds > 86400) wakeSeconds = 10800;  // sane bounds
    https.end();
  }
}

void setup(){
  Serial.begin(115200); delay(50);

  // Power the sensors FIRST — their power LEDs double as a "wiring is good"
  // indicator even before Wi-Fi is configured.
  if (SENSOR_PWR >= 0){ pinMode(SENSOR_PWR, OUTPUT); digitalWrite(SENSOR_PWR, HIGH); }

  // WiFi via captive portal (see header). No WiFi yet → nap, reopen setup.
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  if (!wm.autoConnect("greenr-setup")) {
    Serial.println("No WiFi yet — sleeping, will reopen setup.");
    goToSleep(300);
  }

#if defined(CONFIG_IDF_TARGET_ESP32C3)
  delay(50);                        // AHT10 wants ~40 ms after power-up
  Wire.begin(AHT_SDA, AHT_SCL);
  ahtOk = aht.begin();
  if (!ahtOk) Serial.println("AHT10 not found — check SDA=4 / SCL=5 wiring");
#else
  dht.begin();
#endif
  configTime(0, 0, "pool.ntp.org");
  delay(1200);

  // Live mode: while the app wants fast reads (small wake_seconds), stay awake
  // with WiFi up and read on that cadence. When the app leaves (wake_seconds
  // goes large) or a 10-minute safety cap hits, fall through to deep sleep.
  unsigned long liveStart = millis();
  while (true) {
    readAndUpload();
    if (wakeSeconds > 30) break;                    // app idle → deep sleep
    if (millis() - liveStart > 600000UL) break;     // 10-min live safety cap
    delay((unsigned long)wakeSeconds * 1000UL);     // wait between fast reads
  }

  goToSleep(wakeSeconds > 30 ? wakeSeconds : 300);  // deep sleep (resync if capped)
}

void loop(){}
