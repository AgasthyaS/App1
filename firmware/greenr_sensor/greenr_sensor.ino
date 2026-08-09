/*  greenr sensor — v13: setup hotspot ("greenr-setup"), works on any phone.
 *  ⚠ CHECK YOU HAVE THIS VERSION: on boot the Serial Monitor must print
 *    "===== greenr sensor v13 =====". If it says anything else, the IDE is still
 *    compiling an older copy — select all in the editor, delete, and re-paste.
 *
 *  HOW THE USER SETS IT UP (once), on ANY device — no app, no Bluetooth needed:
 *    join the sensor's own Wi-Fi "greenr-setup" (no password) and a setup page
 *    pops up automatically — pick your network, type the password, done. Works on
 *    iPhone, Android and laptops alike. It then remembers the network across
 *    reboots and power cuts, and reports a reading every 3 hours.
 *    (Optional: set USE_BLE_SETUP 1 to ALSO offer the app's Bluetooth "Find my
 *    sensor" flow at the same time — see the note by that setting.)
 *
 *  TO MAKE IT FORGET AND SET IT UP AGAIN (no code editing needed):
 *    power it on, WAIT ~3 seconds, then HOLD THE "BOOT" BUTTON for 3 seconds.
 *    It wipes the saved Wi-Fi and returns to setup mode. (Don't hold BOOT while
 *    powering on — that puts the chip in firmware-download mode instead.)
 *
 *  The serial monitor prints exactly what it's doing on boot, so if it ever goes
 *  back to setup mode you can see WHY (no saved Wi-Fi / button held / RESET flag).
 *
 *  CAN'T RUN BLUETOOTH SETUP? (iPhone/Safari has no Web Bluetooth, and the QR code
 *  only CLAIMS the sensor to your account — it does not give it Wi-Fi.) Fill in
 *  WIFI_SSID / WIFI_PASS below and flash: it connects directly, no Bluetooth.
 *
 *  ────────────────────────── SETTINGS YOU CAN CHANGE ──────────────────────────
 *   WIFI_SSID/PASS  Optional. Set them to skip Bluetooth setup completely.
 *   RESET           One-shot factory reset. Set to 1, flash, and it wipes the
 *                   saved Wi-Fi ONCE — leaving it at 1 does NOT keep wiping (a
 *                   marker in flash makes it self-disarm), so it can't strand the
 *                   device in setup mode. Prefer the BOOT-button reset above.
 *   USE_DEEP_SLEEP  0 = stay awake between readings (wall power, most reliable).
 *                   1 = deep sleep between readings (battery).
 *   IDLE_SECONDS    how often to report (default 3 h). The server can override.
 *   USE_DHT22 / USE_AHT10   which temp/humidity sensor is wired.
 *  ─────────────────────────────────────────────────────────────────────────────
 *
 *  Bluetooth setup is plain/unencrypted GATT, like Ring's — requiring BLE pairing
 *  made phones hold a half-open link ("Bluetooth is busy") and blocked setup.
 *  Handing over Wi-Fi releases Bluetooth first, then joins on a clean radio (the
 *  ESP32 shares one antenna); the app confirms success via the cloud.
 *  Readings are sent RAW; the Greenr app converts soil/light to %/index.
 *
 *  THIS BUILD = ESP32 dev kit + DHT22. Arduino IDE → Board → "ESP32 Dev Module".
 *
 *  BUILD TROUBLE? If the linker spews "undefined reference to String::~String()"
 *  from HTTPClient, that is a CORRUPTED ARDUINO BUILD CACHE, not a code error:
 *  close the IDE and delete  C:\Users\<you>\AppData\Local\arduino  (it rebuilds).
 *  If you get "text section exceeds available space", either leave USE_BLE_SETUP
 *  at 0 or set Tools → Partition Scheme → "Huge APP (3MB No OTA)". (Changing the
 *  partition scheme erases the saved Wi-Fi, so set the sensor up again after.)
 *  WIRING: LDR AO->34 | soil AOUT->39 ("VN") | soil VCC->19 |
 *          AHT10 SDA->21, SCL->22, VCC->3V3, GND->GND   (current build) |
 *          DHT22 DATA->18, VCC->3V3, GND->GND (10k between DATA and VCC).
 *  LIBRARIES: AHT10 build → "Adafruit AHTX0" (pulls in "Adafruit BusIO" +
 *             "Adafruit Unified Sensor").  DHT22 build → "DHT sensor library".
 */

// ── Include Bluetooth setup? ──────────────────────────────────────────────────
// 0 = SETUP HOTSPOT ONLY (recommended). The "greenr-setup" Wi-Fi + setup page
//     works on EVERY device — iPhone, Android, laptop — with no app needed. This
//     build is MUCH smaller, fits the default partition, and links reliably.
// 1 = also offer Bluetooth ("Find my sensor" in the app). Bigger build: needs
//     Tools → Partition Scheme → "Huge APP (3MB No OTA)".
#define USE_BLE_SETUP 0

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#if USE_BLE_SETUP
  #include <BLEDevice.h>
  #include <BLEServer.h>
  #include <BLEUtils.h>
  #include <BLE2902.h>
#endif
#include <DNSServer.h>
#include <WebServer.h>
#include <esp_task_wdt.h>

// ── Which temp/humidity sensor is wired? Set ONE to 1. ──
//   AHT10 (I2C): SDA -> GPIO21, SCL -> GPIO22, VCC -> 3V3, GND -> GND
//   DHT22 (1-wire): DATA -> GPIO18, VCC -> 3V3, GND -> GND (10k DATA<->VCC)
#define USE_DHT22   0
#define USE_AHT10   1
#if USE_DHT22
  #include <DHT.h>
  #define DHT_PIN   18
  DHT dht(DHT_PIN, DHT22);
#elif USE_AHT10
  #include <Wire.h>
  #include <Adafruit_AHTX0.h>
  #define AHT_SDA   21
  #define AHT_SCL   22
  Adafruit_AHTX0 aht;
  bool ahtOk = false;
#endif

// ─────────── THIS DEVICE = the ESP32 dev kit ───────────
// This id + key MUST match the QR sticker you scan in the app for THIS unit.
#define DEVICE_ID   "ae2da43d-781a-40f7-a3ca-45e5570f5d81"
#define DEVICE_KEY  "b7b1da534f47fef89ebd1f182fef646c"

// ── OPTIONAL: hardcode Wi-Fi and skip Bluetooth setup entirely ──
// Fill these in and the sensor connects straight to this network on boot (it also
// saves them, so it keeps working if you later blank them out). This is the escape
// hatch when you can't run Bluetooth setup — e.g. iPhone/Safari has no Web
// Bluetooth, and the QR code only CLAIMS the sensor to your account, it does not
// give it Wi-Fi. Leave both "" for the normal customer flow (Bluetooth setup).
#define WIFI_SSID  ""
#define WIFI_PASS  ""

// ── Settings (see header) ──
#define RESET          0      // one-shot wipe; self-disarms so it can't loop
#define USE_DEEP_SLEEP 0      // 0 = stay awake (wall power) · 1 = deep sleep (battery)
#define IDLE_SECONDS   10800  // 3 h between readings (server can override)
#define RETRY_SECONDS  300    // after a failed upload, try again in 5 min (NOT a full 3 h)
#define WDT_TIMEOUT_S  60
#define BOOT_BTN       0      // the "BOOT" button — hold 3 s after power-on to factory reset

const char* SUPABASE_URL =
  "https://knyymwvrqitptfzckyvf.supabase.co/rest/v1/rpc/ingest_reading";
const char* SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtueXltd3ZycWl0cHRmemNreXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMjU5NDMsImV4cCI6MjA5ODgwMTk0M30.yPwANlvW6i_F8fnSuAfaCyGccXIJo2Pny83I7tRYtf0";

// UUIDs MUST match the app (lib/wifiSetupTypes.ts).
#define PROV_SERVICE  "c0de0001-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_NETWORKS "c0de0002-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_CREDS    "c0de0003-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_STATUS   "c0de0004-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_DEVICE   "c0de0005-feed-4b1e-9d0b-c0ffee000001"  // id + key → claim with no QR

// ─────────── ESP32 dev-kit pins ───────────
#define LDR_PIN    34
#define SOIL_PIN   39
#define SENSOR_PWR 19

Preferences prefs;
String savedSsid, savedPass;
RTC_DATA_ATTR int sleepSeconds = IDLE_SECONDS;   // survives deep sleep; server can adjust
uint32_t nextReadingAt = 0;                      // millis() deadline for the next reading

// Credentials handed over by EITHER setup path (Bluetooth or the setup page).
#if USE_BLE_SETUP
BLECharacteristic* statusChar = nullptr;
#endif
volatile bool credsReady = false;
String pendingSsid, pendingPass;

// ─────────── saved Wi-Fi (NVS) ───────────
// Every write is READ BACK and verified. A silent NVS failure was indistinguishable
// from "never set up", which is exactly how a configured sensor ends up sitting in
// setup mode forever.
bool saveWifi(const String& ssid, const String& pass){
  prefs.begin("greenr", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  String backSsid = prefs.getString("ssid", "");
  String backPass = prefs.getString("pass", "");
  prefs.end();
  bool ok = (backSsid == ssid) && (backPass == pass);
  Serial.printf(ok ? "Wi-Fi saved to flash (\"%s\") — it will reconnect on its own.\n"
                   : "!! FAILED to save Wi-Fi to flash (\"%s\") — it would forget on reboot.\n",
                ssid.c_str());
  return ok;
}

void loadWifi(){
  prefs.begin("greenr", true);
  savedSsid = prefs.getString("ssid", "");
  savedPass = prefs.getString("pass", "");
  prefs.end();
}

void clearWifi(const char* why){
  prefs.begin("greenr", false);
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.end();
  savedSsid = ""; savedPass = "";
  Serial.printf("Saved Wi-Fi cleared (%s) — entering setup mode.\n", why);
}

// ─────────── climate sensor ───────────
void initClimate(){
#if USE_DHT22
  dht.begin();
#elif USE_AHT10
  Wire.begin(AHT_SDA, AHT_SCL); ahtOk = aht.begin();
#endif
}
bool readClimate(float* t, float* h){
#if USE_DHT22
  for (int i = 0; i < 3; i++){                    // DHT22 misses occasionally — retry
    float tt = dht.readTemperature(), hh = dht.readHumidity();
    if (!isnan(tt) && !isnan(hh)){ *t = tt; *h = hh; return true; }
    delay(400);
  }
  return false;
#elif USE_AHT10
  if (!ahtOk){ Wire.begin(AHT_SDA, AHT_SCL); ahtOk = aht.begin(); }
  if (!ahtOk) return false;
  sensors_event_t he, te;
  if (!aht.getEvent(&he, &te)) return false;
  *t = te.temperature; *h = he.relative_humidity; return true;
#endif
}

// ─────────── Wi-Fi ───────────
bool wifiJoin(const String& ssid, const String& pass, uint32_t ms){
  if (ssid.isEmpty()) return false;
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("Wi-Fi: joining \"%s\" ...\n", ssid.c_str());
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);        // let the stack heal short drops on its own
  WiFi.setSleep(false);               // no modem sleep — a common cause of silent
                                      // disconnects during long idle periods
  WiFi.disconnect(true, true);
  delay(150);
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < ms){
    esp_task_wdt_reset(); delay(250);
  }
  bool ok = WiFi.status() == WL_CONNECTED;
  if (ok) Serial.printf("Wi-Fi connected — IP %s, signal %d dBm\n",
                        WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else    Serial.printf("Wi-Fi FAILED (status=%d). 2.4 GHz only; check the password.\n", WiFi.status());
  return ok;
}

// ─────────── upload (RAW values; the app converts) ───────────
bool uploadRaw(int rawSoil, int rawLight, float t, float h){
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client; client.setInsecure();
  HTTPClient https; https.setConnectTimeout(12000); https.setTimeout(12000);
  if (!https.begin(client, SUPABASE_URL)) return false;
  https.addHeader("Content-Type", "application/json");
  https.addHeader("apikey", SUPABASE_ANON);
  https.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON);

  String body = "{";
  body += "\"p_device\":\"" DEVICE_ID "\",";
  body += "\"p_secret\":\"" DEVICE_KEY "\",";
  body += "\"p_light\":"    + String(rawLight) + ",";   // RAW ADC
  body += "\"p_dli\":0,";
  body += "\"p_soil\":"     + String(rawSoil) + ",";     // RAW ADC
  body += "\"p_temp\":"     + (isnan(t) ? String("null") : String(t, 1)) + ",";
  body += "\"p_humidity\":" + (isnan(h) ? String("null") : String(h, 1)) + ",";
  body += "\"p_battery\":-1,\"p_secs_ago\":0}";

  int code = https.POST(body);
  bool ok = code >= 200 && code < 300;
  if (ok){
    String resp = https.getString();
    Serial.printf("Reading uploaded OK (HTTP %d).\n", code);
    int wi = resp.indexOf("wake_seconds");                // let the server set the cadence
    if (wi >= 0){ int c = resp.indexOf(':', wi); int w = resp.substring(c + 1).toInt(); if (w >= 60 && w <= 86400) sleepSeconds = w; }
  } else {
    Serial.printf("Upload FAILED (HTTP %d): %s\n", code,
                  code > 0 ? https.getString().c_str() : "could not reach the server");
  }
  https.end();
  return ok;
}

// Median of several samples — one stray ADC sample (electrical noise, or the
// probe's oscillator still starting up) was enough to swing a whole reading.
int readAdcStable(int pin){
  int s[7];
  for (int i = 0; i < 7; i++){ s[i] = analogRead(pin); delay(20); }
  for (int i = 1; i < 7; i++){                       // small insertion sort
    int k = s[i], j = i - 1;
    while (j >= 0 && s[j] > k){ s[j + 1] = s[j]; j--; }
    s[j + 1] = k;
  }
  return s[3];                                       // the middle value
}

bool readAndSend(){
  // A capacitive soil probe runs an oscillator that needs time to stabilise after
  // power-up. 80 ms was too short: it could still be settling, giving a LOW raw
  // value that the app then reads as "soaking wet" (100%) on bone-dry soil.
  digitalWrite(SENSOR_PWR, HIGH);
  delay(600);
  int rawSoil  = readAdcStable(SOIL_PIN);
  int rawLight = readAdcStable(LDR_PIN);
  float t = NAN, h = NAN; readClimate(&t, &h);
  // Read these two numbers in AIR and in WATER to calibrate: they map to 0–100%
  // in the app (lib/devices.ts → SOIL_DRY_ADC / SOIL_WET_ADC).
  Serial.printf("read: soil(raw)=%d light(raw)=%d temp=%.1f hum=%.1f\n", rawSoil, rawLight, t, h);
  if (rawSoil < 200)
    Serial.println("  ! soil raw is very low — probe unplugged, or not powered from GPIO19?");
  return uploadRaw(rawSoil, rawLight, t, h);
}

void goToSleep(int s){
  digitalWrite(SENSOR_PWR, LOW);
  esp_task_wdt_delete(NULL);
  // Radios off BEFORE sleeping — leaving Wi-Fi up is a common cause of a board
  // that "won't stay asleep" (power spike / brownout on the sleep entry).
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
  btStop();
  delay(50);
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)s * 1000000ULL);
  esp_deep_sleep_start();
}

// ─────────── Ring-style Bluetooth setup (plain GATT, no pairing) ───────────
#if USE_BLE_SETUP
class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { Serial.println("App connected over Bluetooth."); }
  void onDisconnect(BLEServer* s) override { s->startAdvertising(); }
};
class CredsCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = String(c->getValue().c_str());              // app sends "ssid\npassword"
    int nl = v.indexOf('\n'); if (nl < 0) return;
    pendingSsid = v.substring(0, nl); pendingPass = v.substring(nl + 1);
    credsReady = true;
  }
};
// Shared instances — BLEDevice::deinit() does NOT free user callbacks, so
// re-`new`-ing them on every setup retry would slowly leak the heap.
ServerCB serverCb;
CredsCB  credsCb;
void notifyStatus(const char* s){ if (statusChar){ statusChar->setValue((uint8_t*)s, strlen(s)); statusChar->notify(); } }
#else
void notifyStatus(const char*){}                           // no-op without Bluetooth
#endif

// Networks found by the last scan — shared by the Bluetooth path and the setup
// hotspot's web page.
String   scannedSsid[12];
int      scannedCount = 0;

String scanNetworksJson(){
  int n = WiFi.scanNetworks();
  scannedCount = 0;
  String out = "[";
  for (int i = 0; i < n && i < 12; i++){
    scannedSsid[scannedCount++] = WiFi.SSID(i);
    if (i) out += ",";
    String ss = WiFi.SSID(i); ss.replace("\\", "\\\\"); ss.replace("\"", "\\\"");
    out += "\"" + ss + "\"";
  }
  out += "]"; WiFi.scanDelete(); return out;
}

// ─────────── Setup hotspot + captive portal (works on ANY device, no app) ───────────
// The customer joins the open "greenr-setup" Wi-Fi; their phone pops up a sign-in
// page automatically (that's the captive portal), they pick their home network and
// type the password. This is the universal path — iPhone/Safari included — and it
// needs no Bluetooth and no app install.
DNSServer dnsServer;
WebServer webServer(80);

String htmlEscape(const String& s){
  String o = s;
  o.replace("&", "&amp;"); o.replace("<", "&lt;"); o.replace(">", "&gt;"); o.replace("\"", "&quot;");
  return o;
}

void handlePortalRoot(){
  String p =
    "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>Set up your greenr sensor</title><style>"
    "body{font-family:-apple-system,system-ui,sans-serif;background:#12160f;color:#eee;margin:0;padding:24px}"
    "h1{font-size:20px;margin:0 0 4px}p{color:#9aa38f;font-size:14px;margin:0 0 18px}"
    "label{display:block;font-size:12px;color:#9aa38f;margin:14px 0 4px;letter-spacing:.4px}"
    "select,input{width:100%;box-sizing:border-box;padding:13px;border-radius:11px;border:1px solid #333;"
    "background:#1c211a;color:#fff;font-size:16px}"
    "button{width:100%;margin-top:20px;padding:15px;border:0;border-radius:11px;background:#5a8c4a;"
    "color:#fff;font-size:16px;font-weight:600}</style></head><body>"
    "<h1>Connect your sensor</h1><p>Choose your home Wi-Fi so the sensor can send readings to the app.</p>"
    "<form action='/save' method='POST'><label>NETWORK</label><select name='s'>";
  for (int i = 0; i < scannedCount; i++){
    String e = htmlEscape(scannedSsid[i]);
    p += "<option value='" + e + "'>" + e + "</option>";
  }
  p += "</select><label>OR TYPE A NETWORK NAME (hidden / not listed)</label>"
       "<input name='o' autocomplete='off' placeholder='Leave blank to use the list above'>"
       "<label>PASSWORD</label><input name='p' type='password' autocomplete='off'>"
       "<button type='submit'>Connect</button></form>"
       "<p style='margin-top:18px;font-size:12px'>2.4 GHz networks only — the sensor can't see 5 GHz.</p>"
       "</body></html>";
  webServer.send(200, "text/html", p);
}

void handlePortalSave(){
  String typed = webServer.arg("o"); typed.trim();
  pendingSsid = typed.length() ? typed : webServer.arg("s");   // typed name wins
  pendingPass = webServer.arg("p");
  webServer.send(200, "text/html",
    "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<style>body{font-family:-apple-system,system-ui,sans-serif;background:#12160f;color:#eee;"
    "padding:40px 24px;text-align:center}h1{font-size:20px}p{color:#9aa38f;font-size:14px}</style>"
    "</head><body><h1>Connecting…</h1><p>You can close this page and rejoin your normal Wi-Fi. "
    "Your sensor will appear in the Greenr app within a minute.</p></body></html>");
  credsReady = true;                                   // same handoff the Bluetooth path uses
}

void startPortal(){
  WiFi.softAP("greenr-setup");                          // open network, no password
  delay(300);
  dnsServer.start(53, "*", WiFi.softAPIP());            // every lookup → us = captive portal popup
  webServer.on("/", handlePortalRoot);
  webServer.on("/save", HTTP_POST, handlePortalSave);
  webServer.onNotFound(handlePortalRoot);               // iOS/Android probe URLs land here too
  webServer.begin();
  Serial.printf("SETUP HOTSPOT — join Wi-Fi \"greenr-setup\" (no password), then follow the page "
                "that opens. Or use the app. Portal at http://%s\n", WiFi.softAPIP().toString().c_str());
}

void stopPortal(){
  webServer.stop();
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
}

#if USE_BLE_SETUP
void startBle(const String& netsJson){
  uint8_t mac[6]; WiFi.macAddress(mac);
  char name[20]; snprintf(name, sizeof(name), "greenr-%02X%02X", mac[4], mac[5]);
  BLEDevice::init(name);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(&serverCb);
  BLEService* svc = server->createService(PROV_SERVICE);
  // Plain, unencrypted GATT — like Ring's setup. Requiring BLE pairing/bonding
  // made phones hold a half-open link ("Bluetooth is busy with an earlier
  // connection") and blocked setup entirely.
  BLECharacteristic* netChar = svc->createCharacteristic(CHAR_NETWORKS, BLECharacteristic::PROPERTY_READ);
  netChar->setValue(netsJson.c_str());
  BLECharacteristic* credsChar = svc->createCharacteristic(CHAR_CREDS, BLECharacteristic::PROPERTY_WRITE);
  credsChar->setCallbacks(&credsCb);
  // The device's own id + key → the app can claim it with no QR code.
  BLECharacteristic* idChar = svc->createCharacteristic(CHAR_DEVICE, BLECharacteristic::PROPERTY_READ);
  idChar->setValue((String(DEVICE_ID) + "\n" + DEVICE_KEY).c_str());
  statusChar = svc->createCharacteristic(CHAR_STATUS, BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());
  statusChar->setValue("waiting");
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(PROV_SERVICE);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06); adv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.printf("SETUP MODE — I am \"%s\". Open Greenr and tap \"Find my sensor\".\n", name);
}
#else
void startBle(const String&){}                             // Bluetooth disabled — portal only
#endif

// Advertise for setup and BLOCK until the app hands over WORKING Wi-Fi. On creds,
// release Bluetooth completely, then join Wi-Fi on a clean radio.
// Offer BOTH setup paths at once and block until one of them yields working Wi-Fi:
//   • Bluetooth  — the app's "Find my sensor" (Chrome/Edge/Android, native apps)
//   • Hotspot    — join "greenr-setup" and use the page that pops up (ANY device,
//                  including iPhone/Safari, with no app at all)
// Whichever the customer uses, credentials arrive the same way (credsReady).
void runSetup(){
  WiFi.mode(WIFI_AP_STA);                                  // AP for the portal, STA to scan/join
  WiFi.disconnect();
  String nets = scanNetworksJson();
  startBle(nets);
  startPortal();
  while (true){
    dnsServer.processNextRequest();                        // keep the captive portal responsive
    webServer.handleClient();

    if (credsReady){
      credsReady = false;
      String ss = pendingSsid, pw = pendingPass;
      Serial.printf("Got Wi-Fi details for \"%s\".\n", ss.c_str());
      notifyStatus("connecting");
      delay(600);                                          // let the app/browser see the response
      stopPortal();
#if USE_BLE_SETUP
      BLEDevice::deinit(true);                             // hand the radio fully to Wi-Fi
#endif
      WiFi.mode(WIFI_STA);
      if (wifiJoin(ss, pw, 20000) && saveWifi(ss, pw)){
        return;                                            // app confirms via the cloud upload
      }
      // Wrong password, or the save failed — reopen BOTH paths so it can be retried.
      WiFi.disconnect(true, true);
      WiFi.mode(WIFI_AP_STA);
      nets = scanNetworksJson();
      startBle(nets);
      startPortal();
      notifyStatus("fail");
    }
    esp_task_wdt_reset();
    delay(10);                                             // short — the web server needs servicing
  }
}

// Hold BOOT for 3 s (a few seconds AFTER power-on) to forget the Wi-Fi. Holding it
// DURING power-on can't be used — that's the chip's firmware-download mode.
bool bootButtonHeld(){
  if (digitalRead(BOOT_BTN) != LOW) return false;
  Serial.println("BOOT held — keep holding 3 s to forget the saved Wi-Fi...");
  uint32_t start = millis();
  while (digitalRead(BOOT_BTN) == LOW){
    esp_task_wdt_reset();
    delay(50);
    if (millis() - start >= 3000) return true;
  }
  return false;
}

const char* resetName(esp_reset_reason_t r){
  switch (r){
    case ESP_RST_POWERON:   return "power-on";
    case ESP_RST_DEEPSLEEP: return "timed wake";
    case ESP_RST_BROWNOUT:  return "BROWNOUT (power supply too weak)";
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT:       return "watchdog reset";
    case ESP_RST_PANIC:     return "crash/panic";
    default:                return "reset";
  }
}

void setup(){
  Serial.begin(115200); delay(200);
  // Version banner. If your Serial Monitor does NOT say v13, the Arduino IDE is
  // still compiling an older copy of this file — re-paste it.
  Serial.printf("\n===== greenr sensor v13 =====\n[boot: %s]\ndevice: %s\nsetup method: %s\n",
                resetName(esp_reset_reason()), DEVICE_ID,
                USE_BLE_SETUP ? "hotspot \"greenr-setup\" + Bluetooth" : "hotspot \"greenr-setup\" (no Bluetooth)");

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = { .timeout_ms = (uint32_t)WDT_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&cfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);

  pinMode(BOOT_BTN, INPUT_PULLUP);
  pinMode(SENSOR_PWR, OUTPUT); digitalWrite(SENSOR_PWR, HIGH);
  analogReadResolution(12);            // 0–4095 raw — the app's calibration assumes this
  initClimate();

  loadWifi();

  // One-shot factory reset. The marker means leaving RESET at 1 can NOT keep
  // wiping on every boot — that would strand the sensor in setup mode forever.
  prefs.begin("greenr", false);
  uint8_t resetDone = prefs.getUChar("rstdone", 0);
#if RESET
  if (!resetDone){
    prefs.putUChar("rstdone", 1);
    prefs.end();
    clearWifi("RESET flag");
  } else {
    prefs.end();
    Serial.println("RESET already applied once — ignoring it (set RESET back to 0).");
  }
#else
  if (resetDone) prefs.putUChar("rstdone", 0);   // re-arm for a future one-shot
  prefs.end();
#endif

  // Physical factory reset — the customer-facing way to start over.
  if (bootButtonHeld()) clearWifi("BOOT button held");

  // Hardcoded Wi-Fi wins when present: connect straight away, no Bluetooth needed.
  if (strlen(WIFI_SSID) > 0){
    Serial.printf("Using the Wi-Fi built into this firmware (\"%s\") — skipping Bluetooth setup.\n", WIFI_SSID);
    savedSsid = WIFI_SSID; savedPass = WIFI_PASS;
    if (wifiJoin(savedSsid, savedPass, 20000)) saveWifi(savedSsid, savedPass);
  } else if (savedSsid.isEmpty()){
    Serial.println("No saved Wi-Fi.");
    runSetup();                                            // blocks until the app configures it
    Serial.println("\n===== SET UP — uploading to your app now. =====");
  } else {
    Serial.printf("Saved Wi-Fi found (\"%s\") — connecting, no setup needed.\n", savedSsid.c_str());
    wifiJoin(savedSsid, savedPass, 20000);
  }

  bool ok = readAndSend();                                 // first reading NOW — starts the clock

#if USE_DEEP_SLEEP
  goToSleep(ok ? sleepSeconds : RETRY_SECONDS);            // retry sooner if that upload failed
#else
  nextReadingAt = millis() + (uint32_t)(ok ? sleepSeconds : RETRY_SECONDS) * 1000UL;
  Serial.printf("Next reading in %d s.\n", ok ? sleepSeconds : RETRY_SECONDS);
#endif
}

void loop(){
#if !USE_DEEP_SLEEP
  esp_task_wdt_reset();

  // Let the user factory-reset at any time, not just at boot.
  if (digitalRead(BOOT_BTN) == LOW && bootButtonHeld()){
    clearWifi("BOOT button held");
    ESP.restart();                                         // come back up in setup mode
  }

  // Keep Wi-Fi alive. Over a 3-hour idle the router (or modem-sleep) can silently
  // drop us; checking every 30 s means the radio is already up when a reading is
  // due, instead of discovering it's gone at that moment.
  static uint32_t lastWifiCheck = 0;
  if (millis() - lastWifiCheck >= 30000){
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED){
      Serial.println("Wi-Fi dropped — reconnecting.");
      wifiJoin(savedSsid, savedPass, 20000);
    }
  }

  // Fire on a DEADLINE, not by counting delays (counting accumulated drift, so
  // every cycle ran late). The signed compare is rollover-safe (~49 day wrap).
  if ((int32_t)(millis() - nextReadingAt) >= 0){
    // Anchor the NEXT deadline to the one just due, not to "now". Scheduling from
    // now re-added however long the read + Wi-Fi + upload took (~1-2 min), so the
    // reading time crept later every cycle. Anchoring keeps it on a fixed grid.
    uint32_t dueAt = nextReadingAt;
    if (WiFi.status() != WL_CONNECTED) wifiJoin(savedSsid, savedPass, 20000);
    bool ok = readAndSend();
    // A FAILED upload must NOT cost a whole interval: previously one miss meant
    // waiting the full 3 h again (a 6-hour hole in the app's history).
    uint32_t waitS = ok ? (uint32_t)sleepSeconds : (uint32_t)RETRY_SECONDS;
    if (!ok) Serial.printf("Will retry in %u s.\n", waitS);
    nextReadingAt = dueAt + waitS * 1000UL;
    // If we fell so far behind that the next slot is already past (long outage),
    // resync to now so it doesn't fire repeatedly trying to catch up.
    if ((int32_t)(millis() - nextReadingAt) >= 0) nextReadingAt = millis() + waitS * 1000UL;
  }
  delay(200);
#endif
}
