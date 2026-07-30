/*  greenr sensor — v3.1: hybrid BLE/WiFi sync
 *
 *  WORKS ON BOTH BOARDS — the code auto-detects which one you're compiling for
 *  from Tools → Board and picks the right pins:
 *    • "ESP32 Dev Module"   → original dev kit (LDR 34, soil 39, PWR 19,
 *                             AHT10 on SDA 21 / SCL 22)   ← current unit
 *    • "ESP32C3 Dev Module" → C3 Super Mini (LDR 0, soil 1, PWR 10,
 *                             AHT10 on SDA 4 / SCL 5)
 *
 *  HYBRID SYNC (battery): each cycle the sensor reads, buffers the reading, and
 *  opens a short BLE window. When someone is HOME, the Greenr app collects the
 *  buffer over Bluetooth (cheap) and uploads it to the cloud — the sensor's
 *  power-hungry WiFi radio stays OFF. When nobody's phone has been in range for
 *  ~6 h (they're AWAY/on vacation), the sensor falls back to WiFi on its own so
 *  the cloud stays current, then reverts to BLE when a phone reappears.
 *
 *  Setup is Ring-style: plug in → open the Greenr app → "Find my sensor" → pick
 *  home WiFi and type the password IN THE APP → done. WiFi is remembered across
 *  deep sleep, so setup is a one-time step.
 *
 *  SETUP IS PATIENT — the device never demands attention at power-on. Until it
 *  has WiFi it keeps taking readings and re-offering a Bluetooth setup window
 *  (~every 30 s for the first half hour, then every ~5 min, forever). So a
 *  customer can put batteries in, place the sensor, and open the app whenever
 *  they like. Unplugging and replugging always returns it to the fast cadence.
 *
 *  STATUS LIGHT (STATUS_LED_PIN, default GPIO2 = the onboard LED on most kits):
 *    slow blink = waiting for setup, open the app   |  steady = talking to Wi-Fi
 *    fast blink = hold-to-reset in progress         |  solid 1.5 s = success
 *  Optional SETUP BUTTON (SETUP_BTN_PIN, off by default) reproduces Ring's reset
 *  gesture: hold it 3 s while awake to forget Wi-Fi and return to setup mode.
 *
 *  MOVING / CHANGING ROUTERS: if the saved network fails WIFI_FAIL_RECOVERY
 *  times in a row, the sensor automatically reopens Bluetooth setup for a short
 *  window each wake so the app can point it at the new network. Old credentials
 *  are kept until new ones are proven, so a brief outage self-heals instead of
 *  dropping the device into setup mode. Readings keep buffering (and keep
 *  syncing to a nearby phone over BLE) the whole time, so nothing is lost.
 *
 *  Reads light (LDR), soil (capacitive), temp/humidity (AHT10 on the C3 build,
 *  DHT22 on the legacy dev kit), keeps a running Daily Light Integral, uploads
 *  to Supabase, deep-sleeps. The server controls the sleep interval and can
 *  request an immediate reading (app "read now").
 *
 *  LIBRARIES (Arduino IDE → Library Manager):
 *    - "Adafruit AHTX0" (+ "Adafruit BusIO", "Adafruit Unified Sensor")  [C3 build]
 *    - "DHT sensor library" by Adafruit                                  [legacy dev-kit build]
 *  Bluetooth (BLE), WiFi, and Preferences are built into the ESP32 core — no
 *  extra library to install. Select YOUR board in Tools → Board (see above).
 *
 *  WIRING (original ESP32 dev kit — the current unit):
 *    LDR AO -> GPIO34 | Soil AOUT -> GPIO39 ("VN") | soil VCC -> GPIO19
 *    AHT10 SDA -> GPIO21, SCL -> GPIO22 | AHT10 VCC -> 3V3 | all GND -> GND
 *
 *  DEVICE_ID / DEVICE_KEY: these are unique per unit. The provisioning tool
 *  (scripts/provision-device.mjs) prints the two lines to paste here before you
 *  flash each board, and generates that unit's QR sticker + registers it.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>           // over-the-air firmware updates
#include <Preferences.h>          // save WiFi creds to flash (NVS)
#include <BLEDevice.h>            // Ring-style BLE provisioning (built into ESP32 core)
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLESecurity.h>          // encrypted + authenticated BLE pairing
#include <esp_task_wdt.h>         // watchdog: auto-restart if firmware hangs
#include <time.h>

// ---- Reliability tunables ----
// The watchdog must outlast a LEGITIMATE slow cycle (20 s Wi-Fi join + 12 s
// clock sync + a dozen TLS uploads), or it reboots the device mid-upload and it
// never gets anything out. Every long-running loop feeds it; this is the
// backstop for a genuine hang.
#define WDT_TIMEOUT_S        180
#define WIFI_CONNECT_MS      20000
#define HTTP_TIMEOUT_MS      12000

// ---- Over-the-air updates ----
// Bump this integer every time you publish a new build, and insert a matching
// row in the `firmware` table (see supabase-firmware.sql). v3.1 = 31.
#define FW_VERSION           31
#define OTA_CHECK_EVERY_S    (24*3600)  // check for a new build about once a day

// ---- BLE security (always on) ----
// Every BLE service (Wi-Fi setup AND data sync) requires an ENCRYPTED link:
// LE Secure Connections pairing, enforced by ESP_GATT_PERM_*_ENCRYPTED on the
// characteristics — the stack refuses reads/writes on an unencrypted link, so
// the Wi-Fi password can't be sniffed in transit. Association is "Just Works"
// (no PIN): strong against passive eavesdropping; a per-device passkey printed
// on the label would additionally block active MITM — planned for production.

// ---- Supabase TLS root CA (certificate validation; replaces setInsecure) ----
// The ESP32 verifies the server against this root before sending anything.
// *.supabase.co currently chains to Let's Encrypt "ISRG Root X1". Paste that
// root's PEM below. To fetch the exact current root for YOUR project ref, run:
//   openssl s_client -connect <ref>.supabase.co:443 -showcerts </dev/null \
//     2>/dev/null | openssl x509 -in /dev/stdin  (take the LAST cert in the chain)
// Certs rotate — if the handshake starts failing, refresh this value.
const char* SUPABASE_ROOT_CA = R"CERT(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----

)CERT";
// ---- Climate sensor selection ----
// The ESP32-C3 build always uses an AHT10. If you fitted an AHT10 to the
// ORIGINAL ESP32 dev kit (instead of the DHT22), keep USE_AHT10 = 1.
// Set it back to 0 only if that board still has a DHT22.
#define USE_AHT10   1
#if defined(CONFIG_IDF_TARGET_ESP32C3) || USE_AHT10
  #define CLIMATE_AHT10 1
#else
  #define CLIMATE_AHT10 0
#endif

#if CLIMATE_AHT10
  // AHT10 temp/humidity over I2C.
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
// Pins differ by board. LDR + soil are analog; the climate sensor is either an
// AHT10 (I2C, two pins) or a DHT22 (one digital pin).
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  // ESP32-C3 Super Mini
  #define LDR_PIN    0
  #define SOIL_PIN   1
  #define AHT_SDA    4    // AHT10 SDA
  #define AHT_SCL    5    // AHT10 SCL
  #define SENSOR_PWR 10
#else
  // Original ESP32 dev kit — matches the soldered wiring:
  #define LDR_PIN    34   // light sensor AO   (light VCC on 3V3)
  #define SOIL_PIN   39   // soil AOUT (the "VN" pin = GPIO39)
  #define SENSOR_PWR 19   // soil VCC -> GPIO19: code powers the soil sensor here
  #if CLIMATE_AHT10
    #define AHT_SDA  21   // AHT10 SDA — default ESP32 I2C pin
    #define AHT_SCL  22   // AHT10 SCL — default ESP32 I2C pin
  #else
    #define DHT_PIN  18   // DHT22 Out (DHT VCC on 3V3)
    #define DHTTYPE  DHT22
  #endif
#endif

#if CLIMATE_AHT10
  Adafruit_AHTX0 aht;
  bool ahtOk = false;
#else
  DHT dht(DHT_PIN, DHTTYPE);
#endif

// One buffered reading. Defined up here (before any function) so the Arduino
// IDE's auto-generated prototypes, which it hoists to the top, can see the type.
struct Reading { uint32_t atUptime; int16_t light; float dli; int16_t soil; float temp; float hum; int16_t batt; };

// Temp (°C) + relative humidity (%), from whichever climate sensor this build
// carries. Returns NAN on failure; caller decides what to send.
void readClimate(float* tempC, float* hum){
#if CLIMATE_AHT10
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
RTC_DATA_ATTR int   wakeSeconds = 10800;  // sample interval; server can override

// ---------- HYBRID SYNC: home = BLE (phone gateway), away = Wi-Fi ----------
// A Wi-Fi upload costs ~100-180 mA for several seconds. A BLE exchange costs a
// fraction of that. So each cycle we read the sensor, buffer the reading, and
// open a short BLE window; if a nearby phone (the Greenr app) collects the
// buffer and acknowledges it, the sensor SKIPS Wi-Fi entirely — big battery
// savings while someone is home. If no phone has been seen for WIFI_FALLBACK_S
// (they're away/on vacation), the sensor falls back to Wi-Fi on its own so the
// cloud stays current. Reverts to BLE automatically when a phone reappears.
#define BUF_MAX            48       // ~6 days of buffer at 3 h
#define BLE_WINDOW_MS      12000    // awake window each cycle for a phone to sync
#define WIFI_FALLBACK_S    (6*3600) // no phone this long -> use Wi-Fi

RTC_DATA_ATTR Reading  buf[BUF_MAX];
RTC_DATA_ATTR uint16_t bufCount = 0;
RTC_DATA_ATTR uint32_t uptimeSec = 0;            // monotonic seconds across deep sleep
RTC_DATA_ATTR uint32_t lastPhoneContactSec = 0;  // uptime at last phone ACK (0 = never)
RTC_DATA_ATTR uint32_t lastUploadSec = 0;        // uptime at last successful upload (0 = never)
RTC_DATA_ATTR uint32_t lastOtaCheckSec = 0;      // uptime at last OTA check (0 = never)
// Consecutive failed Wi-Fi joins. After WIFI_FAIL_RECOVERY of them the saved
// network is presumed gone (moved house, new router, changed password) and the
// sensor re-opens Bluetooth setup so the app can hand it new credentials.
RTC_DATA_ATTR uint8_t  wifiFailStreak = 0;
#define WIFI_FAIL_RECOVERY 3

// ---------- PATIENT SETUP MODE (before Wi-Fi is ever configured) ----------
// A customer powers the device on, puts it in a pot, and opens the app whenever
// they get around to it — maybe in a minute, maybe tomorrow. So an unconfigured
// sensor NEVER blocks waiting for the app. It takes a reading, advertises over
// Bluetooth for a window, naps, and repeats — staying findable indefinitely.
//
// The cadence backs off so it is snappy exactly when someone is likely setting
// up, then sips power afterwards:
//   first ~20 tries (~30 min) : offer every ~30 s   — feels instant
//   after that               : offer every ~5 min  — still findable, low drain
//
// RTC memory is wiped by a power cycle, so UNPLUGGING AND REPLUGGING always
// returns the device to the snappy phase — a natural "I'm setting it up now"
// gesture we can tell users about.
// ---------- STATUS LIGHT + SETUP BUTTON (Ring-style physical feedback) ----------
// A sensor with no light is a black box: you cannot tell "waiting for setup"
// from "connected" from "dead". The LED makes the state visible the way a Ring
// device does.
//   slow blink  = waiting for setup (open the app)
//   fast blink  = connecting / uploading
//   solid 2 s   = success
// Most ESP32 dev kits have an LED on GPIO2. Set to -1 if yours doesn't (nothing
// breaks either way — an unused pin just toggles harmlessly).
#define STATUS_LED_PIN       2

// OPTIONAL hardware reset button, like Ring's setup button. Wire a momentary
// button between the chosen pin and GND, then hold it while the sensor is awake
// to forget Wi-Fi and return to setup mode.
//   -1  = no button fitted (default; the automatic recovery already covers
//         moving house, so a button is a convenience, not a requirement)
//   33  = a good free RTC-capable pin on this build (34/39/19/21/22 are taken)
// Do NOT use GPIO0 — it is the boot-mode strapping pin and holding it low at
// power-on drops the chip into firmware-download mode instead.
#define SETUP_BTN_PIN        -1
#define SETUP_BTN_HOLD_MS    3000

#define SETUP_WINDOW_MS      45000    // how long each Bluetooth offer lasts
#define SETUP_FAST_TRIES     20       // tries kept on the snappy cadence
#define SETUP_NAP_FAST_S     30
#define SETUP_NAP_SLOW_S     300
RTC_DATA_ATTR uint16_t setupAttempts = 0;

// ---- Status light ----------------------------------------------------------
// ledTick() is non-blocking: call it inside the loops that already run (they
// delay in small steps anyway) and it toggles on its own schedule.
void ledInit(){
  if (STATUS_LED_PIN >= 0){ pinMode(STATUS_LED_PIN, OUTPUT); digitalWrite(STATUS_LED_PIN, LOW); }
}
void ledSet(bool on){
  if (STATUS_LED_PIN >= 0) digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
}
void ledTick(uint32_t periodMs){
  if (STATUS_LED_PIN < 0) return;
  ledSet(((millis() / periodMs) % 2) == 0);
}
/** Solid for a beat — used to confirm success in a way you can see across a room. */
void ledSuccess(){
  if (STATUS_LED_PIN < 0) return;
  ledSet(true); delay(1500); ledSet(false);
}

/** True while the optional setup button is held down (active-low to GND). */
bool setupButtonHeld(){
  if (SETUP_BTN_PIN < 0) return false;
  return digitalRead(SETUP_BTN_PIN) == LOW;
}

/**
 * Ring-style manual reset: hold the setup button and the sensor forgets its
 * Wi-Fi and returns to setup mode. Only reachable while the device is awake,
 * which is every wake cycle — and the LED confirms it took.
 */
bool checkSetupButton(Preferences& p){
  if (SETUP_BTN_PIN < 0 || !setupButtonHeld()) return false;
  Serial.println("Setup button held — keep holding to forget Wi-Fi...");
  uint32_t start = millis();
  while (setupButtonHeld()){
    ledTick(120);                                   // fast blink = "keep holding"
    esp_task_wdt_reset();
    delay(50);
    if (millis() - start >= SETUP_BTN_HOLD_MS){
      p.begin("greenr", false);
      p.remove("ssid"); p.remove("pass");
      p.end();
      Serial.println("Wi-Fi forgotten — returning to setup mode.");
      ledSuccess();
      return true;
    }
  }
  ledSet(false);
  return false;
}

int clampPct(long v){ return v<0?0:(v>100?100:(int)v); }

// JSON formatters that emit `null` for failed sensors instead of fake values.
String fNull(float v){ return isnan(v) ? String("null") : String(v,1); }
String iNull(int v){ return v < 0 ? String("null") : String(v); }

void goToSleep(int s){
  if (SENSOR_PWR >= 0) digitalWrite(SENSOR_PWR, LOW);
  uptimeSec += (uint32_t)s;                       // account for the sleep we're about to take
  Serial.printf("Sleeping %d s\n", s); Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)s * 1000000ULL);
  esp_deep_sleep_start();
}

// Read every sensor once and append the result to the buffer (does NOT upload).
// Failed/implausible sensors are stored as sentinels (soil/light = -1, temp/hum
// = NAN) and uploaded as NULL — never as fake zeros that would look like real
// "0% / freezing" data. If EVERY sensor fails, we skip buffering entirely.
void readSensorsIntoBuffer(){
  int rawLight = analogRead(LDR_PIN);
  int rawSoil  = analogRead(SOIL_PIN);
  float tempC, hum;
  readClimate(&tempC, &hum);

  // Soil: a capacitive probe should sit mid-range; a rail-stuck reading (0 or
  // near full-scale 4095) means it's disconnected/shorted → invalid.
  int16_t soilPct = -1;
  if (rawSoil > 5 && rawSoil < 4090)
    soilPct = (int16_t)clampPct(map(rawSoil, SOIL_AIR, SOIL_WATER, 0, 100));

  // Light: raw of exactly 0 or 4095 with no divider movement is suspect, but
  // legitimate darkness/brightness lives near the rails too, so only reject a
  // hard 0-and-open case. Otherwise accept.
  int16_t lightIdx = -1;
  float lightFrac = (float)(rawLight - LIGHT_DARK) / (float)(LIGHT_BRIGHT - LIGHT_DARK);
  if (lightFrac < 0) lightFrac = 0; if (lightFrac > 1) lightFrac = 1;
  lightIdx = (int16_t)(lightFrac * 100);
  if (soilPct >= 0)  // only integrate DLI when the board's ADC looks alive
    dliAccum += (lightFrac * 2000.0) * (float)wakeSeconds / 1000000.0;

  // Temp/humidity: keep NAN on failure (readClimate already returns NAN) —
  // do NOT coerce to 0.
  bool anyValid = (soilPct >= 0) || !isnan(tempC) || !isnan(hum);

  struct tm ti;
  if (getLocalTime(&ti, 200)){ if (ti.tm_yday != dayOfYear){ dayOfYear = ti.tm_yday; dliAccum = 0; } }

  Serial.printf("read: light=%d soil=%d temp=%.1f hum=%.1f valid=%d (buf %d)\n",
                lightIdx, soilPct, tempC, hum, anyValid, bufCount+1);
  if (!anyValid){ Serial.println("all sensors failed — skipping this reading"); return; }

  Reading r = { uptimeSec, lightIdx, dliAccum, soilPct, tempC, hum, (int16_t)-1 };
  if (bufCount >= BUF_MAX){                        // full: drop the oldest
    memmove(&buf[0], &buf[1], sizeof(Reading)*(BUF_MAX-1));
    bufCount = BUF_MAX-1;
  }
  buf[bufCount++] = r;
}

// Post ONE buffered reading over Wi-Fi. `secsAgo` preserves the real capture
// time server-side (ingest_reading accepts p_secs_ago). Returns wake_seconds.
bool postReadingWifi(const Reading& r, uint32_t secsAgo){
  String body = "{";
  body += "\"p_device\":\"" DEVICE_ID "\",";
  body += "\"p_secret\":\"" DEVICE_KEY "\",";
  body += "\"p_light\":"    + iNull(r.light) + ",";
  body += "\"p_dli\":"      + String(r.dli,3) + ",";
  body += "\"p_soil\":"     + iNull(r.soil) + ",";
  body += "\"p_temp\":"     + fNull(r.temp) + ",";
  body += "\"p_humidity\":" + fNull(r.hum) + ",";
  body += "\"p_battery\":"  + iNull(r.batt) + ",";
  body += "\"p_secs_ago\":" + String(secsAgo) + "}";

  // TLS: validate the server against the pinned Supabase root CA. NEVER
  // setInsecure() — that would let an on-path attacker MITM the device.
  WiFiClientSecure client;
  client.setCACert(SUPABASE_ROOT_CA);
  client.setTimeout(HTTP_TIMEOUT_MS / 1000);       // socket timeout (seconds)
  HTTPClient https;
  https.setConnectTimeout(HTTP_TIMEOUT_MS);
  https.setTimeout(HTTP_TIMEOUT_MS);
  if (!https.begin(client, SUPABASE_URL)) return false;
  https.addHeader("Content-Type","application/json");
  https.addHeader("apikey", SUPABASE_ANON);
  https.addHeader("Authorization", String("Bearer ")+SUPABASE_ANON);
  int code = https.POST(body);                     // returns <0 on TLS/timeout failure
  if (code > 0){
    String resp = https.getString();
    int wi = resp.indexOf("wake_seconds");
    if (wi >= 0){ int c = resp.indexOf(':', wi); wakeSeconds = resp.substring(c+1).toInt(); }
    if (wakeSeconds < 5 || wakeSeconds > 86400) wakeSeconds = 10800;
    if (code < 200 || code >= 300)
      Serial.printf("Server rejected the reading (HTTP %d): %s\n", code, resp.c_str());
  } else {
    // Negative codes are client-side: -1 connection refused, -5 connection lost.
    // The usual cause here is a TLS failure (wrong clock or stale root CA).
    Serial.printf("HTTPS failed (%d: %s). Clock=%lu. Will retry next wake.\n",
                  code, HTTPClient::errorToString(code).c_str(), (unsigned long)time(nullptr));
  }
  https.end();
  return code >= 200 && code < 300;
}

// Once a day, ask the server whether a newer build exists; if so, download and
// flash it, then reboot into it. Runs only when Wi-Fi is already up.
void maybeCheckOta(){
  if (uptimeSec - lastOtaCheckSec < (uint32_t)OTA_CHECK_EVERY_S && lastOtaCheckSec != 0) return;
  lastOtaCheckSec = uptimeSec;

  const char* base = "https://knyymwvrqitptfzckyvf.supabase.co";
  String manifest = String(base) +
    "/rest/v1/firmware?select=version,url&channel=eq.stable&order=version.desc&limit=1";

  WiFiClientSecure client; client.setCACert(SUPABASE_ROOT_CA);
  HTTPClient https; https.setConnectTimeout(HTTP_TIMEOUT_MS); https.setTimeout(HTTP_TIMEOUT_MS);
  if (!https.begin(client, manifest)) return;
  https.addHeader("apikey", SUPABASE_ANON);
  https.addHeader("Authorization", String("Bearer ")+SUPABASE_ANON);
  int code = https.GET();
  if (code != 200){ https.end(); return; }
  String body = https.getString();
  https.end();

  // Cheap parse: [{"version":32,"url":"https://..."}]
  int vi = body.indexOf("\"version\":");
  int ui = body.indexOf("\"url\":\"");
  if (vi < 0 || ui < 0) return;
  int newVer = body.substring(vi + 10).toInt();
  int us = ui + 7; int ue = body.indexOf('"', us);
  String url = body.substring(us, ue);
  if (newVer <= FW_VERSION || url.length() < 8) return;

  Serial.printf("OTA: v%d available (have v%d) — updating from %s\n", newVer, FW_VERSION, url.c_str());
  esp_task_wdt_delete(NULL);                         // the flash can take a while
  WiFiClientSecure otaClient; otaClient.setCACert(SUPABASE_ROOT_CA);
  httpUpdate.setLedPin(-1);
  t_httpUpdate_return r = httpUpdate.update(otaClient, url);
  if (r == HTTP_UPDATE_FAILED)
    Serial.printf("OTA failed (%d): %s — will retry tomorrow\n",
                  httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
  // On success the chip reboots into the new firmware automatically.
  esp_task_wdt_add(NULL);
}

// Flush the buffer over Wi-Fi (oldest first), clearing what uploads OK.
// Each reading is its own TLS handshake, so a full 48-reading backlog would keep
// the radio up for minutes; MAX_UPLOADS_PER_WAKE bounds one wake's work and the
// rest goes out next cycle. Feeds the watchdog between posts.
#define MAX_UPLOADS_PER_WAKE 12
void uploadBufferWifi(){
  uint16_t sent = 0;
  uint16_t limit = bufCount < MAX_UPLOADS_PER_WAKE ? bufCount : MAX_UPLOADS_PER_WAKE;
  for (uint16_t i = 0; i < limit; i++){
    esp_task_wdt_reset();                          // each POST can take seconds
    uint32_t secsAgo = uptimeSec - buf[i].atUptime;
    if (!postReadingWifi(buf[i], secsAgo)) break;  // stop on first failure; retry next cycle
    sent++;
  }
  if (sent){
    memmove(&buf[0], &buf[sent], sizeof(Reading)*(bufCount-sent));
    bufCount -= sent;
    lastUploadSec = uptimeSec;
    Serial.printf("Wi-Fi uploaded %d readings (%d still buffered)\n", sent, bufCount);
  } else {
    Serial.printf("Uploaded nothing this wake (%d readings still buffered)\n", bufCount);
  }
}

// ================= Ring-style BLE Wi-Fi provisioning =================
// UUIDs MUST match the app (lib/wifiSetupTypes.ts).
#define PROV_SERVICE  "c0de0001-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_NETWORKS "c0de0002-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_CREDS    "c0de0003-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_STATUS   "c0de0004-feed-4b1e-9d0b-c0ffee000001"

Preferences prefs;
BLECharacteristic* statusChar = nullptr;
volatile bool provDone = false;      // set once WiFi joins and creds are saved
volatile bool credsReady = false;    // app just wrote a new ssid/password
String pendingSsid, pendingPass;

void notifyStatus(const char* s){
  if (statusChar){ statusChar->setValue((uint8_t*)s, strlen(s)); statusChar->notify(); }
  Serial.printf("prov status: %s\n", s);
}

// Try to join a network, blocking up to timeoutMs. Returns true on success.
// Feeds the watchdog while it waits — this loop can run 20 s, and without
// feeding it the WDT fires mid-connect and reboots the device in a loop.
bool tryConnect(const String& ssid, const String& pass, uint32_t timeoutMs){
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs){
    esp_task_wdt_reset();
    delay(250);
  }
  bool ok = WiFi.status() == WL_CONNECTED;
  Serial.printf("Wi-Fi %s (%lu ms)\n", ok ? "connected" : "FAILED", (unsigned long)(millis() - start));
  return ok;
}

/**
 * Set the clock from NTP and WAIT for it to actually land.
 *
 * This is REQUIRED before any HTTPS request: validating the Supabase
 * certificate compares its validity dates against the system clock, and a
 * freshly powered board starts in 1970 — so the certificate looks "not yet
 * valid" and EVERY upload fails with a TLS error. (The old firmware used
 * setInsecure(), which skipped validation and therefore never needed the time;
 * that is why uploads stopped when certificate checking was turned on.)
 *
 * The RTC keeps running through deep sleep, so this normally only has to do
 * real work on the first boot after power-up.
 */
bool syncClock(uint32_t timeoutMs = 12000){
  if (time(nullptr) > 1700000000UL) return true;      // already sane (kept across deep sleep)
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  uint32_t start = millis();
  while (time(nullptr) < 1700000000UL && millis() - start < timeoutMs){
    esp_task_wdt_reset();
    delay(250);
  }
  bool ok = time(nullptr) > 1700000000UL;
  if (ok) Serial.printf("Clock synced (%lu ms)\n", (unsigned long)(millis() - start));
  else    Serial.println("Clock NOT synced — HTTPS will fail certificate checks. Check the network allows NTP (UDP 123).");
  return ok;
}

// Receives "ssid\npassword" from the app.
class CredsCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = String(c->getValue().c_str());
    int nl = v.indexOf('\n');
    if (nl < 0) return;
    pendingSsid = v.substring(0, nl);
    pendingPass = v.substring(nl + 1);
    credsReady = true;
  }
};

// JSON array of nearby SSIDs (strongest first), for the app's network picker.
String scanNetworksJson(){
  int n = WiFi.scanNetworks();
  String out = "[";
  for (int i = 0; i < n && i < 12; i++){
    if (i) out += ",";
    String ss = WiFi.SSID(i);
    ss.replace("\\", "\\\\"); ss.replace("\"", "\\\"");
    out += "\"" + ss + "\"";
  }
  out += "]";
  WiFi.scanDelete();
  return out;
}

// Encrypted BLE pairing (Secure Connections) so the Wi-Fi password can't be
// sniffed during setup. "Just Works" association: the phone pairs automatically
// (no PIN prompt) and the link is encrypted, which protects against passive
// eavesdropping. Written for ESP32 core 3.x (avoids the 2.x-only setEncryption-
// Level / setSecurityCallbacks that don't exist there). The characteristic
// permissions below (ENCRYPTED) are what force the link to encrypt.
void enableBleSecurity(){
  BLESecurity* sec = new BLESecurity();
  sec->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);   // Secure Connections + bonding
  sec->setCapability(ESP_IO_CAP_NONE);                    // no display/keyboard → Just Works
  sec->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
}

// Advertise over BLE so the app can hand over Wi-Fi credentials, for ONE window.
// Returns true if credentials were accepted, false if the window simply expired.
//
// It never blocks indefinitely and never sleeps by itself — the caller decides
// what to do next. That is what lets a customer power the device on, walk away,
// and set it up whenever they get to the app: the sensor just keeps offering
// itself at a sensible cadence instead of demanding attention right now.
//   recovery = false : first-time setup window.
//   recovery = true  : the saved network stopped working (moved house, new
//                      router, changed password) — a shorter re-configure window
//                      so a brief outage can't strand the device in setup mode.
bool runProvisioning(bool recovery){
  provDone = false;
  credsReady = false;
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  String netsJson = scanNetworksJson();

  uint8_t mac[6]; WiFi.macAddress(mac);
  char name[16]; snprintf(name, sizeof(name), "greenr-%02X%02X", mac[4], mac[5]);

  BLEDevice::init(name);
  enableBleSecurity();                              // encrypted + authenticated pairing
  BLEServer* server = BLEDevice::createServer();
  BLEService* svc = server->createService(PROV_SERVICE);

  BLECharacteristic* netChar =
    svc->createCharacteristic(CHAR_NETWORKS, BLECharacteristic::PROPERTY_READ);
  netChar->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED);
  netChar->setValue(netsJson.c_str());

  BLECharacteristic* credsChar =
    svc->createCharacteristic(CHAR_CREDS, BLECharacteristic::PROPERTY_WRITE);
  // The stack requires an ENCRYPTED link before it accepts the Wi-Fi password.
  credsChar->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  credsChar->setCallbacks(new CredsCallback());

  statusChar = svc->createCharacteristic(CHAR_STATUS, BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());
  statusChar->setValue("waiting");

  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(PROV_SERVICE);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.printf("BLE provisioning as %s — open the Greenr app to connect.\n", name);

  uint32_t start = millis();
  while (!provDone){
    if (credsReady){
      credsReady = false;
      notifyStatus("connecting");
      ledSet(true);                             // steady while it joins
      adv->stop();                              // free the radio for WiFi
      bool ok = tryConnect(pendingSsid, pendingPass, 15000);
      if (ok){
        prefs.begin("greenr", false);
        prefs.putString("ssid", pendingSsid);
        prefs.putString("pass", pendingPass);
        prefs.end();
        notifyStatus("ok");
        delay(700);                             // let the app read "ok"
        wifiFailStreak = 0;                     // the new network works
        provDone = true;
        ledSuccess();                           // visible "you're connected"
      } else {
        notifyStatus("fail");                   // wrong password → let them retry
        ledSet(false);
        WiFi.disconnect();
        BLEDevice::startAdvertising();
      }
    }
    // Window expired with nobody connecting. Hand control back to the caller —
    // never sleep from in here, so setup can be retried on a sane schedule.
    if (millis() - start > (recovery ? 90000UL : SETUP_WINDOW_MS)){
      Serial.println("Setup window closed — nobody connected. Will offer again shortly.");
      BLEDevice::deinit(true);
      ledSet(false);
      return false;
    }
    ledTick(700);                                  // slow blink = waiting for the app
    esp_task_wdt_reset();                          // stay alive during the long wait
    delay(100);
  }
  BLEDevice::deinit(true);                       // release BLE; WiFi is up + saved
  return true;
}
// =====================================================================

// ================= HYBRID SYNC: BLE data window (phone gateway) =================
// UUIDs MUST match the app (lib/bleGatewayTypes.ts).
#define DATA_SERVICE  "c0de0010-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_DATA     "c0de0011-feed-4b1e-9d0b-c0ffee000001"  // read: buffered readings (JSON)
#define CHAR_ACK      "c0de0012-feed-4b1e-9d0b-c0ffee000001"  // write: count the phone uploaded

#define MAX_ROWS_PER_READ 8        // keep one CHAR_DATA read under the ~512 B limit

BLECharacteristic* dataChar = nullptr;
volatile bool phoneSynced = false;

// Build the JSON of the oldest readings that fit one BLE read (BleBatch shape).
String buildDataJson(){
  String s = "{\"dev\":\"" DEVICE_ID "\",\"fw\":\"3.1\",\"rows\":[";
  int n = bufCount < MAX_ROWS_PER_READ ? bufCount : MAX_ROWS_PER_READ;
  for (int i = 0; i < n; i++){
    if (i) s += ",";
    uint32_t ago = uptimeSec - buf[i].atUptime;
    s += "{\"ago\":" + String(ago) +
         ",\"l\":" + iNull(buf[i].light) +
         ",\"d\":" + String(buf[i].dli,2) +
         ",\"s\":" + iNull(buf[i].soil) +
         ",\"t\":" + fNull(buf[i].temp) +
         ",\"h\":" + fNull(buf[i].hum) +
         ",\"b\":" + iNull(buf[i].batt) + "}";
  }
  s += "]}";
  return s;
}

// The phone writes how many readings it successfully uploaded → drop them and
// record that a phone was here (so we can skip the Wi-Fi fallback this cycle).
class AckCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    int n = String(c->getValue().c_str()).toInt();
    if (n <= 0) return;
    if (n > bufCount) n = bufCount;
    memmove(&buf[0], &buf[n], sizeof(Reading)*(bufCount-n));
    bufCount -= n;
    lastPhoneContactSec = uptimeSec;
    phoneSynced = true;
    if (dataChar) dataChar->setValue(buildDataJson().c_str());   // serve the next batch
    Serial.printf("phone took %d readings (buf %d)\n", n, bufCount);
  }
};

// Advertise the data service for a short window so a nearby phone can collect
// the buffer. Cheap compared to Wi-Fi; runs every cycle.
void runBleWindow(){
  uint8_t mac[6]; WiFi.macAddress(mac);
  char name[16]; snprintf(name, sizeof(name), "greenr-%02X%02X", mac[4], mac[5]);
  BLEDevice::init(name);
  enableBleSecurity();                              // same encryption as setup
  BLEServer* server = BLEDevice::createServer();
  BLEService* svc = server->createService(DATA_SERVICE);
  dataChar = svc->createCharacteristic(CHAR_DATA, BLECharacteristic::PROPERTY_READ);
  // Readings only go to a phone that has paired (encrypted link) — a stranger
  // nearby can't read your plant data.
  dataChar->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED);
  dataChar->setValue(buildDataJson().c_str());
  BLECharacteristic* ackChar = svc->createCharacteristic(CHAR_ACK, BLECharacteristic::PROPERTY_WRITE);
  // The ACK deletes buffered readings — without encryption, anyone in range
  // could write a bogus count and silently destroy your data. Encrypted only.
  ackChar->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  ackChar->setCallbacks(new AckCallback());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(DATA_SERVICE);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.printf("BLE data window %d ms (buf %d)\n", BLE_WINDOW_MS, bufCount);

  uint32_t start = millis();
  while (millis() - start < BLE_WINDOW_MS){ esp_task_wdt_reset(); delay(50); }

  BLEDevice::deinit(true);
  uptimeSec += BLE_WINDOW_MS / 1000;             // account for the awake window
}
// ================================================================================

void initSensors(){
#if CLIMATE_AHT10
  delay(50);                        // AHT10 wants ~40 ms after power-up
  Wire.begin(AHT_SDA, AHT_SCL);
  ahtOk = aht.begin();
  if (!ahtOk) Serial.printf("AHT10 not found — check SDA=%d / SCL=%d wiring\n", AHT_SDA, AHT_SCL);
#else
  dht.begin();
#endif
}

void setup(){
  Serial.begin(115200); delay(300);
  // Boot banner — the first thing to check when a sensor goes quiet. `reset`
  // repeatedly showing TASK_WDT or PANIC means it is rebooting, not sleeping.
  Serial.printf("\n=== greenr v%d boot | reset=%d | buffered=%u | wifiFails=%u ===\n",
                FW_VERSION, (int)esp_reset_reason(), bufCount, wifiFailStreak);

  // Watchdog: if any part of this wake cycle hangs (Wi-Fi stack lockup, I2C bus
  // stall, TLS stall), the WDT resets the chip — which simply re-enters this
  // cycle or, worst case, deep-sleeps and retries next wake. Never bricks.
  // The init API differs between ESP32 core 2.x and 3.x, so guard by version.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdtCfg = { .timeout_ms = (uint32_t)WDT_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&wdtCfg);            // core 3.x already inits the TWDT
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);       // core 2.x
#endif
  esp_task_wdt_add(NULL);

  // Power the sensors FIRST — their power LEDs double as a "wiring is good"
  // indicator even before Wi-Fi is configured.
  if (SENSOR_PWR >= 0){ pinMode(SENSOR_PWR, OUTPUT); digitalWrite(SENSOR_PWR, HIGH); }
  ledInit();
  if (SETUP_BTN_PIN >= 0) pinMode(SETUP_BTN_PIN, INPUT_PULLUP);

  // Held setup button = "forget my Wi-Fi and start over" (Ring's reset gesture).
  bool forced = checkSetupButton(prefs);
  if (forced) setupAttempts = 0;                 // treat it as a fresh setup

  // Provisioning check: saved Wi-Fi creds survive deep sleep, so this only runs
  // on first setup or a router change.
  prefs.begin("greenr", true);
  String savedSsid = prefs.getString("ssid", "");
  String savedPass = prefs.getString("pass", "");
  prefs.end();

  initSensors();
  readSensorsIntoBuffer();           // always measure — even before it's set up,
                                     // so history exists from the moment of power-on

  bool justProvisioned = false;
  if (!savedSsid.length()){
    // NOT SET UP YET. Offer a Bluetooth setup window, then nap and offer again.
    // Never blocks — the user can open the app whenever they like.
    setupAttempts++;
    Serial.printf("Not set up yet (offer #%u). Open Greenr and tap \"Find my sensor\".\n", setupAttempts);
    if (runProvisioning(false)){
      prefs.begin("greenr", true);
      savedSsid = prefs.getString("ssid", "");
      savedPass = prefs.getString("pass", "");
      prefs.end();
      setupAttempts = 0;
      justProvisioned = true;
    } else {
      // Nobody connected this time. Nap and try again — snappy at first, then
      // backing off to save power while staying discoverable indefinitely.
      int nap = setupAttempts <= SETUP_FAST_TRIES ? SETUP_NAP_FAST_S : SETUP_NAP_SLOW_S;
      Serial.printf("Next Bluetooth offer in %d s. (Unplug and replug for fast setup.)\n", nap);
      esp_task_wdt_delete(NULL);
      goToSleep(nap);
    }
  } else if (wifiFailStreak >= WIFI_FAIL_RECOVERY){
    // The saved network has failed repeatedly — most likely the sensor moved to
    // a new home, the router changed, or the password was updated. Re-open
    // Bluetooth setup so the app can hand over new credentials. The old ones are
    // KEPT until new ones are proven, so a temporary outage self-heals.
    Serial.printf("Wi-Fi failed %u times — reopening Bluetooth setup.\n", wifiFailStreak);
    if (runProvisioning(true)){
      prefs.begin("greenr", true);
      savedSsid = prefs.getString("ssid", "");
      savedPass = prefs.getString("pass", "");
      prefs.end();
      justProvisioned = true;        // new network is live — upload straight away
    }
  }

  if (justProvisioned){
    // Fresh setup: Wi-Fi is already connected — upload immediately so the user
    // sees a reading right away. The clock MUST be set before HTTPS or the
    // certificate check fails (see syncClock).
    syncClock();
    uploadBufferWifi();
    maybeCheckOta();
  } else {
    // Normal cycle: offer the buffer over BLE first (cheap). A phone that's home
    // collects it and we skip Wi-Fi entirely.
    runBleWindow();

    bool neverSynced = (lastPhoneContactSec == 0 && lastUploadSec == 0);
    uint32_t sinceContact = uptimeSec - lastPhoneContactSec;
    bool phoneCovering = (lastPhoneContactSec != 0) && (sinceContact < (uint32_t)WIFI_FALLBACK_S);
    bool bufferPressure = bufCount >= BUF_MAX - 2;
    // Use Wi-Fi only when BLE isn't covering us: never synced, buffer filling,
    // or no phone seen for WIFI_FALLBACK_S (they're away).
    bool useWifi = neverSynced || bufferPressure || (!phoneSynced && !phoneCovering);

    if (useWifi){
      if (tryConnect(savedSsid, savedPass, WIFI_CONNECT_MS)){
        wifiFailStreak = 0;                      // network is healthy again
        ledSet(true);                            // lit while it talks to the cloud
        syncClock();                             // required before any HTTPS
        uploadBufferWifi();
        maybeCheckOta();
        ledSet(false);
      } else if (wifiFailStreak < 255) {
        // Count the miss. Enough of them and the next wake reopens Bluetooth
        // setup so the sensor can be pointed at a different network.
        wifiFailStreak++;
        Serial.printf("Wi-Fi join failed (%u in a row). Readings stay buffered.\n", wifiFailStreak);
      }
    } else {
      Serial.println("Covered by a nearby phone — skipping Wi-Fi (battery saved).");
    }
  }

  // Live mode: only meaningful while Wi-Fi is up (app watching). Fast-read loop
  // until the app releases it (wake_seconds grows) or the 10-min cap hits.
  if (WiFi.status() == WL_CONNECTED && wakeSeconds <= 30){
    unsigned long liveStart = millis();
    while (wakeSeconds <= 30 && millis() - liveStart < 600000UL){
      esp_task_wdt_reset();
      delay((unsigned long)wakeSeconds * 1000UL);
      readSensorsIntoBuffer();
      uploadBufferWifi();
    }
  }

  esp_task_wdt_delete(NULL);                        // stop watching before we sleep
  goToSleep(wakeSeconds > 30 ? wakeSeconds : 300);
}

void loop(){}
