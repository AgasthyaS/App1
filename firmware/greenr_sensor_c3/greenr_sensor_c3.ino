/*  greenr sensor — ESP32-C3 Super Mini — firmware c3-1.0
 *
 *  ⚠ CHECK YOU HAVE THIS VERSION: on boot the Serial Monitor prints
 *    "===== greenr sensor c3-1.0 =====". If it says anything else, the IDE is
 *    compiling a different copy of this file.
 *
 *  ★ FOR EACH NEW DEVICE you change only DEVICE_ID and DEVICE_KEY.
 *    Search this file for "CHANGE THESE 2 LINES".
 *
 *  ───────────────────────────────── HARDWARE ─────────────────────────────────
 *    ESP32-C3 Super Mini · AHT10 (temperature + humidity) · BH1750 (light, lux)
 *    capacitive soil moisture sensor · one lithium cell (3.7 V) + 2-resistor divider
 *
 *    Pins are the ones proposed for the C3 in docs/HARDWARE.md. Go by the GPIO
 *    numbers PRINTED ON THE BOARD, not by position.
 *
 *      Soil sensor  AOUT → GPIO3   VCC → GPIO10 (switched on only while reading)   GND → GND
 *      AHT10        SDA  → GPIO6   SCL → GPIO7    VIN/VCC → 3V3    GND → GND
 *      BH1750       SDA  → GPIO6   SCL → GPIO7    VCC → 3V3        GND → GND    ADDR → not connected
 *      Battery      +    → 5V pin  (through a charger/protection board if you have one)   − → GND
 *      Divider      OPTIONAL, only for the battery % in the app. If you fit it, set HAS_BATTERY 1:
 *                   battery + ─ 100 kΩ ─┬─ 100 kΩ ─ GND
 *                                       └→ GPIO1
 *      BOOT button  GPIO9 (on the board)
 *
 *    Never connect the battery to the 3V3 pin: a full cell is 4.2 V and the chip's
 *    limit is 3.6 V. Unplug the battery before plugging in USB to upload.
 *
 *  ──────────────────────────────── ARDUINO IDE ───────────────────────────────
 *    Boards Manager:  "esp32" by Espressif (3.x)
 *    Tools → Board:   "ESP32C3 Dev Module"
 *    USB CDC On Boot: "Enabled"   (otherwise the Serial Monitor shows nothing)
 *    Flash Mode:      "DIO"
 *    Library Manager: "Adafruit AHTX0" (accept its dependencies) and
 *                     "BH1750" by Christopher Laws
 *    If an upload won't start: hold BOOT, tap RST, let go of BOOT, upload again.
 *    The sensor sleeps between readings, so it is invisible to the IDE most of the
 *    time — that BOOT + RST step is how you reach it.
 *
 *  ──────────────────────────────── FIRST SETUP ───────────────────────────────
 *    Join the open Wi-Fi "greenr-setup" with your phone, pick your home network on
 *    the page that opens, done. On battery the setup network stays open for
 *    SETUP_TIMEOUT_MIN minutes; press RST to open it again.
 *
 *    To forget the saved Wi-Fi: tap RST, then within 2 seconds press and HOLD BOOT
 *    for 3 seconds. (Holding BOOT WHILE tapping RST is the chip's upload mode
 *    instead — let go of RST first.)
 *
 *  ──────────────────────────────── WHAT IT SENDS ─────────────────────────────
 *    Raw soil count (0–4095, high = dry), lux, °C, %RH, battery millivolts, Wi-Fi
 *    signal, firmware version — to Supabase rpc/ingest_v2, which needs
 *    supabase/migrations/20261112120000_c3_sensors.sql. Readings that cannot be
 *    uploaded (Wi-Fi down) are kept in RTC memory and sent with the next upload.
 *    The app turns the raw soil count into a moisture index using THIS sensor's
 *    own air and water readings (Greenr → your sensor → Calibrate).
 */

#if !defined(CONFIG_IDF_TARGET_ESP32C3)
#error "This sketch is for the ESP32-C3. Tools → Board → ESP32C3 Dev Module."
#endif

// ─────────────────────────── settings you may change ───────────────────────────
#define FW_VERSION        "c3-1.0"
#define USE_DEEP_SLEEP    1        // 1 = battery: sleep between readings · 0 = USB power, stay awake
#define USE_BLE_SETUP     0        // 1 = also offer the app's Bluetooth setup (needs "Huge APP" partition)
#define HAS_BATTERY       0        // 1 ONLY if the two-resistor divider is wired to GPIO1 (shows battery %
                                   // in the app). Leave 0 without it: an unconnected GPIO1 reads a random
                                   // voltage that can look like a flat battery and stop the uploads.
#define VERIFY_TLS        1        // check the server's certificate; 0 only to diagnose (see ROOT_CAS)
#define IDLE_SECONDS      10800    // 3 h between readings. The server can change it (devices.wake_seconds).
#define RETRY_SECONDS     300      // first retry after a failed upload; doubles per failure, capped at IDLE
#define SETUP_TIMEOUT_MIN 20       // on battery, close the setup hotspot after this long
#define WIFI_TX_POWER     WIFI_POWER_8_5dBm
                                   // Many Super Mini boards cannot join Wi-Fi at full power (a known
                                   // antenna/regulator weakness). 8.5 dBm fixes it for most. If your
                                   // router is far away and the board joins reliably, try 15 dBm.
#define RESET             0        // 1 = forget the saved Wi-Fi once on next boot (self-disarms)

// Optional: build your Wi-Fi in and skip the setup hotspot.
#define WIFI_SSID  ""
#define WIFI_PASS  ""

// ── Battery: one lithium cell (Li-ion / LiPo, 3.7 V nominal, 4.2 V full) ──
#define BAT_DIVIDER       2.0f     // (R_top + R_bottom) / R_bottom — 2.0 for two equal resistors
#define BAT_PRESENT_MV    2500     // below this at the cell, nothing is connected (running from USB)
#define BAT_CUTOFF_MV     3400     // below this, skip Wi-Fi: the regulator cannot hold 3.3 V through a
                                   // transmission, and a lithium cell should not be run flat
#define BAT_LOW_SLEEP_S   43200    // when too low, check again after 12 h

// =============================================================================
// >>>>>>>>>>>>>>>>>>  CHANGE THESE 2 LINES FOR EACH DEVICE  <<<<<<<<<<<<<<<<<<<
//   1. In the project folder run:   npm run provision -- "Sensor name"
//   2. It prints two #define lines. Paste them over the two lines below.
//   3. It also saves a QR picture (provisioned/<id>.png). Stick that QR on the
//      SAME board you upload this sketch to. One run = one board.
// =============================================================================
#define DEVICE_ID   "ae2da43d-781a-40f7-a3ca-45e5570f5d81"
#define DEVICE_KEY  "b7b1da534f47fef89ebd1f182fef646c"
// =============================================================================
// >>>>>>>>>>  END OF PER-DEVICE LINES: nothing else needs changing  <<<<<<<<<<<
// =============================================================================

const char* SUPABASE_URL =
  "https://knyymwvrqitptfzckyvf.supabase.co/rest/v1/rpc/ingest_v2";
const char* SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtueXltd3ZycWl0cHRmemNreXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMjU5NDMsImV4cCI6MjA5ODgwMTk0M30.yPwANlvW6i_F8fnSuAfaCyGccXIJo2Pny83I7tRYtf0";

// ─────────── pins (ESP32-C3 GPIO numbers) ───────────
#define SOIL_PIN    3     // ADC1_CH3 — ADC1 keeps working while Wi-Fi is on; ADC2 (GPIO5) does not
#define BAT_PIN     1     // ADC1_CH1
#define I2C_SDA     6
#define I2C_SCL     7
#define BOOT_BTN    9     // on-board BOOT button (a strapping pin — nothing else is wired to it)
#define SENSOR_PWR  10    // powers the soil sensor only while it is read
// Left alone on purpose: GPIO2 and GPIO8 (strapping), GPIO18/19 (USB), GPIO20/21 (UART).

#define BH1750_ADDR      0x23    // ADDR pin left open (the module pulls it low)
#define SOIL_WARMUP_MS   600     // the probe's oscillator settles before it is read

// UUIDs must match the app (lib/wifiSetupTypes.ts).
#define PROV_SERVICE  "c0de0001-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_NETWORKS "c0de0002-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_CREDS    "c0de0003-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_STATUS   "c0de0004-feed-4b1e-9d0b-c0ffee000001"
#define CHAR_DEVICE   "c0de0005-feed-4b1e-9d0b-c0ffee000001"

#define WDT_TIMEOUT_S 60

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <BH1750.h>
#include <esp_task_wdt.h>
#include <esp_sleep.h>
#include <sys/time.h>
#if USE_BLE_SETUP
  #include <BLEDevice.h>
  #include <BLEServer.h>
  #include <BLEUtils.h>
  #include <BLE2902.h>
#endif

/*
 * Certificate authorities trusted for the upload. On 2026-11-12 the Supabase
 * endpoint's chain was  supabase.co ← WE1 ← GTS Root R4  (Google Trust Services).
 * Supabase sits behind a CDN that can also issue through Let's Encrypt, so its
 * roots are included too. Checked against the live server with a strict TLS
 * client before shipping. If uploads ever fail with a certificate error, the CA
 * has changed: add its root here (or set VERIFY_TLS 0 to confirm that is the cause).
 *
 *   GTS Root R1, GTS Root R4 — valid to 2036 · ISRG Root X1 — to 2035 · ISRG Root X2 — to 2040
 */
static const char ROOT_CAS[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
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
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
)PEM";

// ─────────── state that survives deep sleep (RTC memory) ───────────
// Lost on power-up and on the RST button — which is fine: it is only a buffer.
struct Sample {
  int64_t at;     // seconds on the chip's clock, which keeps counting in deep sleep (±a few %)
  int16_t soil;   // raw ADC count; -1 = not read
  int16_t batMv;  // millivolts at the cell; -1 = no battery
  float   lux;    // NAN = not read
  float   t;      // °C, NAN = not read
  float   h;      // %RH, NAN = not read
};
#define MAX_BACKLOG 24                         // 3 days at the 3-hour default
#define RTC_MAGIC   0x47524E31UL               // "GRN1": RTC memory holds our data, not noise
RTC_DATA_ATTR uint32_t rtcMagic = 0;
RTC_DATA_ATTR Sample   backlog[MAX_BACKLOG];
RTC_DATA_ATTR uint8_t  backlogCount = 0;
RTC_DATA_ATTR int      sleepSeconds = IDLE_SECONDS;
RTC_DATA_ATTR uint8_t  failCount = 0;
RTC_DATA_ATTR int32_t  apChannel = 0;          // last router's channel + BSSID: rejoining with them
RTC_DATA_ATTR uint8_t  apBssid[6] = {0};       // skips the scan and saves 1–2 s of radio per wake

Preferences prefs;
String savedSsid, savedPass;
Adafruit_AHTX0 aht;
BH1750 lightMeter(BH1750_ADDR);
bool ahtOk = false, bhOk = false;
uint32_t nextReadingAt = 0;                    // awake mode only

// Credentials handed over by EITHER setup path (Bluetooth or the setup page).
#if USE_BLE_SETUP
BLECharacteristic* statusChar = nullptr;
#endif
volatile bool credsReady = false;
String pendingSsid, pendingPass;

int64_t nowSec(){
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec;
}

// ─────────── saved Wi-Fi (NVS) ───────────
// Every write is READ BACK and verified: a silent flash failure looks exactly like
// "never set up", which is how a configured sensor ends up stuck in setup mode.
bool saveWifi(const String& ssid, const String& pass){
  prefs.begin("greenr", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  String backSsid = prefs.getString("ssid", "");
  String backPass = prefs.getString("pass", "");
  prefs.end();
  bool ok = (backSsid == ssid) && (backPass == pass);
  Serial.printf(ok ? "Wi-Fi saved (\"%s\") — it will reconnect on its own.\n"
                   : "!! FAILED to save Wi-Fi (\"%s\") — it would forget on reboot.\n",
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
  apChannel = 0;
  Serial.printf("Saved Wi-Fi cleared (%s) — setup mode next.\n", why);
}

// ─────────── factory reset by BOOT button ───────────
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

// Called from every wait loop, so "hold BOOT for 3 s" works whenever the sensor is awake.
void watchResetButton(){
  if (digitalRead(BOOT_BTN) == LOW && bootButtonHeld()){
    clearWifi("BOOT button held");
    delay(200);
    ESP.restart();                               // comes back up in setup mode
  }
}

// ─────────── sensors ───────────
void initSensors(){
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000);
  ahtOk = aht.begin(&Wire);
  bhOk  = lightMeter.begin(BH1750::ONE_TIME_HIGH_RES_MODE, BH1750_ADDR, &Wire);
  Serial.printf("AHT10 %s · BH1750 %s\n",
                ahtOk ? "found" : "NOT FOUND (SDA→GPIO6, SCL→GPIO7, VIN→3V3, GND)",
                bhOk  ? "found" : "NOT FOUND (SDA→GPIO6, SCL→GPIO7, VCC→3V3, GND, ADDR open)");
}

bool readClimate(float* t, float* h){
  if (!ahtOk) return false;
  sensors_event_t he, te;
  if (!aht.getEvent(&he, &te)) return false;
  if (isnan(te.temperature) || isnan(he.relative_humidity)) return false;
  *t = te.temperature; *h = he.relative_humidity;
  return true;
}

/*
 * One BH1750 measurement in one-time mode: the sensor measures once and powers
 * itself down (≈0.01 µA), which is what a battery sensor wants.
 * configure() restarts the measurement and its timer; measurementReady(true) waits
 * the datasheet maximum for the current integration time.
 */
float measureLuxOnce(){
  lightMeter.configure(BH1750::ONE_TIME_HIGH_RES_MODE);
  uint32_t t0 = millis();
  while (!lightMeter.measurementReady(true)){
    if (millis() - t0 > 1000) break;
    delay(5);
  }
  return lightMeter.readLightLevel();            // negative = I2C error
}

/*
 * Auto-ranging. At the default integration time (MTreg 69) the BH1750 reads up to
 * 65535 / 1.2 ≈ 54 600 lux, and sun through a window can exceed that. Above
 * 40 000 lux the reading is repeated at the shortest integration time (MTreg 31),
 * which reaches 65535 / 1.2 × 69/31 ≈ 121 500 lux. The library scales the result,
 * so both readings are in lux. The database flags anything at that ceiling.
 */
float readLux(){
  if (!bhOk) return NAN;
  float lux = measureLuxOnce();
  if (lux < 0) return NAN;
  if (lux > 40000.0f && lightMeter.setMTreg(BH1750_MTREG_MIN)){
    float bright = measureLuxOnce();
    if (bright >= 0) lux = bright;
    lightMeter.setMTreg(BH1750_DEFAULT_MTREG);   // next boot starts sensitive again
  }
  return lux;
}

/*
 * Battery voltage at the cell, in millivolts, or -1 when none is connected.
 * analogReadMilliVolts() applies the chip's factory ADC calibration; the divider
 * halves the cell voltage (4.2 V → 2.1 V) so it stays in the ADC's accurate range.
 * Read BEFORE Wi-Fi starts: a transmission sags the cell by 100 mV or more.
 */
int readBatteryMv(){
#if HAS_BATTERY
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++){ sum += analogReadMilliVolts(BAT_PIN); delay(2); }
  float mv = (sum / 16.0f) * BAT_DIVIDER;
  return mv < BAT_PRESENT_MV ? -1 : (int)lroundf(mv);
#else
  return -1;
#endif
}

// Median of several samples: one stray ADC sample (noise, or the probe's oscillator
// still settling) was enough to swing a whole reading.
int readAdcMedian(int pin){
  int s[9];
  for (int i = 0; i < 9; i++){ s[i] = analogRead(pin); delay(15); }
  for (int i = 1; i < 9; i++){                   // insertion sort
    int k = s[i], j = i - 1;
    while (j >= 0 && s[j] > k){ s[j + 1] = s[j]; j--; }
    s[j + 1] = k;
  }
  return s[4];
}

/*
 * Everything is read before the radio starts: the AHT10 is not warmed by the
 * Wi-Fi chip, the battery is read unloaded, and the probe is powered only for
 * the ~0.8 s this takes.
 */
Sample takeSample(){
  Sample s;
  s.at = nowSec();
  s.soil = -1; s.batMv = -1; s.lux = NAN; s.t = NAN; s.h = NAN;

  digitalWrite(SENSOR_PWR, HIGH);
  uint32_t poweredAt = millis();

  s.batMv = readBatteryMv();
  float t, h;
  if (readClimate(&t, &h)){ s.t = t; s.h = h; }
  s.lux = readLux();

  while (millis() - poweredAt < SOIL_WARMUP_MS) delay(5);
  int raw = readAdcMedian(SOIL_PIN);
  digitalWrite(SENSOR_PWR, LOW);
  s.soil = raw;

  Serial.printf("read: soil raw=%d  lux=%.1f  temp=%.1f °C  hum=%.1f %%  battery=%d mV\n",
                s.soil, s.lux, s.t, s.h, s.batMv);
  if (raw < 200)
    Serial.println("  ! soil raw is very low — probe unplugged, or its VCC is not on GPIO10?");
  if (raw >= 4090)
    Serial.println("  ! soil raw is at the top of the scale — fine in open air; in soil, check AOUT → GPIO3.");
  return s;
}

void pushBacklog(const Sample& s){
  if (backlogCount >= MAX_BACKLOG){              // full: drop the oldest
    memmove(&backlog[0], &backlog[1], sizeof(Sample) * (MAX_BACKLOG - 1));
    backlogCount = MAX_BACKLOG - 1;
  }
  backlog[backlogCount++] = s;
}

// ─────────── Wi-Fi ───────────
bool waitConnected(uint32_t ms){
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < ms){
    esp_task_wdt_reset();
    watchResetButton();
    delay(100);
  }
  return WiFi.status() == WL_CONNECTED;
}

bool wifiJoin(const String& ssid, const String& pass){
  if (ssid.isEmpty()) return false;
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("Wi-Fi: joining \"%s\" ...\n", ssid.c_str());
  WiFi.persistent(false);                        // credentials live in our own NVS slot
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_TX_POWER);
  bool ok = false;
  if (apChannel > 0){                            // fast path: same router as last time
    WiFi.begin(ssid.c_str(), pass.c_str(), apChannel, apBssid);
    WiFi.setTxPower(WIFI_TX_POWER);
    ok = waitConnected(6000);
    if (!ok){ WiFi.disconnect(); delay(100); }
  }
  if (!ok){
    WiFi.begin(ssid.c_str(), pass.c_str());
    WiFi.setTxPower(WIFI_TX_POWER);
    ok = waitConnected(15000);
  }
  if (ok){
    apChannel = WiFi.channel();
    const uint8_t* b = WiFi.BSSID();
    if (b) memcpy(apBssid, b, 6);
    Serial.printf("Wi-Fi connected — IP %s, signal %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    apChannel = 0;
    Serial.printf("Wi-Fi FAILED (status %d). 2.4 GHz only; check the password and the distance.\n", WiFi.status());
  }
  return ok;
}

// ─────────── upload ───────────
String jsonNum(float v, int dp){ return isnan(v) ? String("null") : String(v, dp); }

String rowJson(const Sample& s, int64_t now){
  int64_t ago = now - s.at;
  if (ago < 0) ago = 0;
  String r = "{\"ago\":";
  r += String((long)ago);
  r += ",\"soil\":"; r += (s.soil >= 0 ? String(s.soil) : String("null"));
  r += ",\"lux\":";  r += jsonNum(s.lux, 1);
  r += ",\"t\":";    r += jsonNum(s.t, 1);
  r += ",\"h\":";    r += jsonNum(s.h, 1);
  r += ",\"bat\":";  r += (s.batMv > 0 ? String(s.batMv) : String("null"));
  r += "}";
  return r;
}

/*
 * One POST carries every reading not yet delivered, oldest first. The server
 * skips any it already has, so a retry after a lost response never duplicates.
 */
bool uploadBacklog(){
  if (WiFi.status() != WL_CONNECTED || backlogCount == 0) return false;
  int64_t now = nowSec();
  String body = "{\"p_device\":\"" DEVICE_ID "\",\"p_secret\":\"" DEVICE_KEY "\",\"p_fw\":\"" FW_VERSION "\",\"p_rssi\":";
  body += String(WiFi.RSSI());
  body += ",\"p_rows\":[";
  for (int i = 0; i < backlogCount; i++){
    if (i) body += ",";
    body += rowJson(backlog[i], now);
  }
  body += "]}";

  WiFiClientSecure client;
#if VERIFY_TLS
  client.setCACert(ROOT_CAS);
#else
  client.setInsecure();
#endif
  HTTPClient https;
  https.setConnectTimeout(10000);
  https.setTimeout(10000);
  if (!https.begin(client, SUPABASE_URL)){
    Serial.println("Upload FAILED: could not start the request.");
    return false;
  }
  https.addHeader("Content-Type", "application/json");
  https.addHeader("apikey", SUPABASE_ANON);
  https.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON);

  int code = https.POST(body);
  String resp = code > 0 ? https.getString() : String();
  https.end();

  if (code >= 200 && code < 300){
    Serial.printf("Uploaded %d reading%s (HTTP %d): %s\n", backlogCount, backlogCount == 1 ? "" : "s", code, resp.c_str());
    int wi = resp.indexOf("wake_seconds");       // the server sets the cadence
    if (wi >= 0){
      int c = resp.indexOf(':', wi);
      int w = resp.substring(c + 1).toInt();
      if (w >= 60 && w <= 86400) sleepSeconds = w;
    }
    return true;
  }
  if (code <= 0){
    Serial.printf("Upload FAILED: %s.%s\n", HTTPClient::errorToString(code).c_str(),
                  VERIFY_TLS ? " If this is a certificate error, see ROOT_CAS in the sketch." : "");
  } else {
    Serial.printf("Upload FAILED (HTTP %d): %s\n", code, resp.c_str());
    if (resp.indexOf("ingest_v2") >= 0)
      Serial.println("  → Run supabase/migrations/20261112120000_c3_sensors.sql in Supabase first.");
    if (resp.indexOf("bad device or secret") >= 0)
      Serial.println("  → DEVICE_ID / DEVICE_KEY do not match a provisioned device.");
  }
  return false;
}

// Wait after a failed upload: 5, 10, 20, 40, 80 min… never longer than the normal interval.
uint32_t retryDelay(){
  uint32_t d = (uint32_t)RETRY_SECONDS << (failCount < 5 ? failCount : 5);
  if (failCount < 255) failCount++;
  return d < (uint32_t)sleepSeconds ? d : (uint32_t)sleepSeconds;
}

void sleepFor(uint32_t seconds){
  digitalWrite(SENSOR_PWR, LOW);
  esp_task_wdt_delete(NULL);
  // Radios off BEFORE sleeping: leaving Wi-Fi up is a common cause of a board that
  // "won't stay asleep" (current spike / brownout on the way in).
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
  if (seconds > 0){
    Serial.printf("Sleeping %u s.\n", (unsigned)seconds);
    esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  } else {
    Serial.println("Sleeping until RST is pressed.");
  }
  Serial.flush();
  delay(20);
  esp_deep_sleep_start();
}

// ─────────── Bluetooth setup (optional, plain GATT, no pairing) ───────────
#if USE_BLE_SETUP
class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { Serial.println("App connected over Bluetooth."); }
  void onDisconnect(BLEServer* s) override { s->startAdvertising(); }
};
class CredsCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = String(c->getValue().c_str());    // app sends "ssid\npassword"
    int nl = v.indexOf('\n'); if (nl < 0) return;
    pendingSsid = v.substring(0, nl); pendingPass = v.substring(nl + 1);
    credsReady = true;
  }
};
ServerCB serverCb;
CredsCB  credsCb;
void notifyStatus(const char* s){ if (statusChar){ statusChar->setValue((uint8_t*)s, strlen(s)); statusChar->notify(); } }
#else
void notifyStatus(const char*){}
#endif

// Networks found by the last scan, for the setup page and the Bluetooth path.
String scannedSsid[12];
int    scannedCount = 0;

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
  out += "]";
  WiFi.scanDelete();
  return out;
}

// ─────────── setup hotspot + captive portal (works on ANY phone, no app) ───────────
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
  pendingSsid = typed.length() ? typed : webServer.arg("s");   // a typed name wins
  pendingPass = webServer.arg("p");
  webServer.send(200, "text/html",
    "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<style>body{font-family:-apple-system,system-ui,sans-serif;background:#12160f;color:#eee;"
    "padding:40px 24px;text-align:center}h1{font-size:20px}p{color:#9aa38f;font-size:14px}</style>"
    "</head><body><h1>Connecting…</h1><p>You can close this page and rejoin your normal Wi-Fi. "
    "Your sensor will appear in the Greenr app within a minute.</p></body></html>");
  credsReady = true;
}

void startPortal(){
  WiFi.softAP("greenr-setup");                   // open network, no password
  WiFi.setTxPower(WIFI_TX_POWER);
  delay(300);
  dnsServer.start(53, "*", WiFi.softAPIP());     // every lookup → us = the captive-portal popup
  webServer.on("/", handlePortalRoot);
  webServer.on("/save", HTTP_POST, handlePortalSave);
  webServer.onNotFound(handlePortalRoot);        // the phones' probe URLs land here too
  webServer.begin();
  Serial.printf("SETUP HOTSPOT — join Wi-Fi \"greenr-setup\" (no password). Portal at http://%s\n",
                WiFi.softAPIP().toString().c_str());
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
  BLECharacteristic* netChar = svc->createCharacteristic(CHAR_NETWORKS, BLECharacteristic::PROPERTY_READ);
  netChar->setValue(netsJson.c_str());
  BLECharacteristic* credsChar = svc->createCharacteristic(CHAR_CREDS, BLECharacteristic::PROPERTY_WRITE);
  credsChar->setCallbacks(&credsCb);
  BLECharacteristic* idChar = svc->createCharacteristic(CHAR_DEVICE, BLECharacteristic::PROPERTY_READ);
  idChar->setValue((String(DEVICE_ID) + "\n" + DEVICE_KEY).c_str());
  statusChar = svc->createCharacteristic(CHAR_STATUS, BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());
  statusChar->setValue("waiting");
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(PROV_SERVICE);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.printf("SETUP MODE — I am \"%s\". Open Greenr and tap \"Find my sensor\".\n", name);
}
#else
void startBle(const String&){}
#endif

/*
 * Offer setup and wait for working Wi-Fi. Returns false if `timeoutMs` passes
 * first (on battery an open hotspot draws ~80 mA, so it cannot stay up for days).
 */
bool runSetup(uint32_t timeoutMs){
  WiFi.mode(WIFI_AP_STA);                        // AP for the page, STA to scan and join
  WiFi.disconnect();
  String nets = scanNetworksJson();
  startBle(nets);
  startPortal();
  uint32_t opened = millis();
  while (true){
    dnsServer.processNextRequest();
    webServer.handleClient();

    if (credsReady){
      credsReady = false;
      String ss = pendingSsid, pw = pendingPass;
      Serial.printf("Got Wi-Fi details for \"%s\".\n", ss.c_str());
      notifyStatus("connecting");
      delay(600);                                // let the phone show the response page
      stopPortal();
#if USE_BLE_SETUP
      BLEDevice::deinit(true);
#endif
      apChannel = 0;                             // a new network: no fast path
      if (wifiJoin(ss, pw) && saveWifi(ss, pw)){
        savedSsid = ss; savedPass = pw;
        return true;
      }
      // Wrong password, or the save failed: reopen and give them the full time again.
      WiFi.disconnect(true, true);
      WiFi.mode(WIFI_AP_STA);
      nets = scanNetworksJson();
      startBle(nets);
      startPortal();
      notifyStatus("fail");
      opened = millis();
    }
    if (timeoutMs && millis() - opened > timeoutMs){
      stopPortal();
      return false;
    }
    esp_task_wdt_reset();
    delay(10);
  }
}

const char* resetName(esp_reset_reason_t r){
  switch (r){
    case ESP_RST_POWERON:   return "power-on / RST";
    case ESP_RST_DEEPSLEEP: return "timed wake";
    case ESP_RST_BROWNOUT:  return "BROWNOUT (battery low or supply too weak)";
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT:       return "watchdog reset";
    case ESP_RST_PANIC:     return "crash/panic";
    case ESP_RST_SW:        return "restart";
    default:                return "reset";
  }
}

// Send what we have and decide how long to wait before the next reading.
uint32_t deliver(const Sample& s){
  pushBacklog(s);
  bool ok = (WiFi.status() == WL_CONNECTED) && uploadBacklog();
  if (ok){
    backlogCount = 0;
    failCount = 0;
    return (uint32_t)sleepSeconds;
  }
  uint32_t wait = retryDelay();
  Serial.printf("%d reading%s kept for the next upload. Retrying in %u s.\n",
                backlogCount, backlogCount == 1 ? "" : "s", (unsigned)wait);
  return wait;
}

void setup(){
  Serial.begin(115200);
  esp_reset_reason_t why = esp_reset_reason();
  bool timedWake = (why == ESP_RST_DEEPSLEEP);
  if (!timedWake) delay(1500);                   // give the USB Serial Monitor time to attach

  if (rtcMagic != RTC_MAGIC){                    // power-up: RTC memory is not ours yet
    rtcMagic = RTC_MAGIC;
    backlogCount = 0; failCount = 0; apChannel = 0; sleepSeconds = IDLE_SECONDS;
  }

  Serial.printf("\n===== greenr sensor %s =====\n[boot: %s]  device: %s  backlog: %d\n",
                FW_VERSION, resetName(why), DEVICE_ID, backlogCount);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = { .timeout_ms = (uint32_t)WDT_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&cfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);

  pinMode(BOOT_BTN, INPUT_PULLUP);
  pinMode(SENSOR_PWR, OUTPUT);
  digitalWrite(SENSOR_PWR, LOW);
  analogReadResolution(12);                      // 0–4095: the app's calibration expects this
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);
  analogSetPinAttenuation(BAT_PIN, ADC_11db);
  initSensors();

  loadWifi();

  // One-shot factory reset from the RESET setting. The marker stops it wiping on
  // every boot, which would strand the sensor in setup mode.
  prefs.begin("greenr", false);
  uint8_t resetDone = prefs.getUChar("rstdone", 0);
#if RESET
  if (!resetDone){
    prefs.putUChar("rstdone", 1);
    prefs.end();
    clearWifi("RESET setting");
  } else {
    prefs.end();
    Serial.println("RESET already applied once — ignoring it (set RESET back to 0).");
  }
#else
  if (resetDone) prefs.putUChar("rstdone", 0);
  prefs.end();
#endif

  // After RST or power-up, a 2-second window to hold BOOT and forget the Wi-Fi.
  // Skipped on timed wakes, which happen with nobody there.
  if (!timedWake){
    Serial.println("Hold BOOT now for 3 s to forget the saved Wi-Fi.");
    uint32_t t0 = millis();
    while (millis() - t0 < 2000){
      if (digitalRead(BOOT_BTN) == LOW && bootButtonHeld()){ clearWifi("BOOT button held"); break; }
      delay(20);
    }
  }

  Sample s = takeSample();
  bool onBattery = s.batMv > 0;

  if (onBattery && s.batMv < BAT_CUTOFF_MV){
    Serial.printf("Battery at %d mV, below %d mV: not starting Wi-Fi. Charge it.\n", s.batMv, BAT_CUTOFF_MV);
    pushBacklog(s);                              // kept: uploads after a recharge without a reset
#if USE_DEEP_SLEEP
    sleepFor(BAT_LOW_SLEEP_S);
#endif
  }

  if (strlen(WIFI_SSID) > 0){
    Serial.printf("Using the Wi-Fi built into this firmware (\"%s\").\n", WIFI_SSID);
    savedSsid = WIFI_SSID; savedPass = WIFI_PASS;
    if (wifiJoin(savedSsid, savedPass)) saveWifi(savedSsid, savedPass);
  } else if (savedSsid.isEmpty()){
    Serial.println("No saved Wi-Fi.");
    bool ok = runSetup(onBattery ? (uint32_t)SETUP_TIMEOUT_MIN * 60000UL : 0);
    if (!ok){
      Serial.printf("Setup was open for %d min with no answer. Press RST to open it again.\n", SETUP_TIMEOUT_MIN);
      sleepFor(0);                               // wakes only on RST: an idle hotspot would empty the battery
    }
    Serial.println("\n===== SET UP — uploading to your app now. =====");
  } else {
    Serial.printf("Saved Wi-Fi found (\"%s\").\n", savedSsid.c_str());
    wifiJoin(savedSsid, savedPass);
  }

  uint32_t wait = deliver(s);

#if USE_DEEP_SLEEP
  sleepFor(wait);
#else
  nextReadingAt = millis() + wait * 1000UL;
  Serial.printf("Next reading in %u s.\n", (unsigned)wait);
#endif
}

void loop(){
#if !USE_DEEP_SLEEP
  esp_task_wdt_reset();
  watchResetButton();

  // Keep Wi-Fi alive between readings, so the radio is up when one is due.
  static uint32_t lastWifiCheck = 0;
  if (millis() - lastWifiCheck >= 30000){
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED && !savedSsid.isEmpty()){
      Serial.println("Wi-Fi dropped — reconnecting.");
      wifiJoin(savedSsid, savedPass);
    }
  }

  // Fire on a deadline, not by counting delays. The signed compare is rollover-safe.
  if ((int32_t)(millis() - nextReadingAt) >= 0){
    Sample s = takeSample();
    if (WiFi.status() != WL_CONNECTED) wifiJoin(savedSsid, savedPass);
    uint32_t wait = deliver(s);
    nextReadingAt = millis() + wait * 1000UL;
  }
  delay(200);
#endif
}
