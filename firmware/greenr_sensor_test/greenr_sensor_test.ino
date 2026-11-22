/*  greenr sensor — HARDWARE TEST — ESP32-C3 Super Mini — test t1.0
 *
 *  Upload this BEFORE the real sensor code to check that every part is wired
 *  right and working. It tests the board, the USB power, the I²C wiring, the
 *  AHT10, the BH1750, the soil probe (and that GPIO10 switches its power) and
 *  the Wi-Fi radio, then walks you through 4 quick hands-on checks. It ends
 *  with a PASS / WARN / FAIL list that says exactly what to fix.
 *
 *  It uploads NOTHING, joins no Wi-Fi network and changes no settings. Your
 *  saved Wi-Fi is kept. When everything passes, upload the real sensor code:
 *  firmware/greenr_sensor_c3/greenr_sensor_c3.ino
 *
 *  ★ NO BATTERY NEEDED. The board runs from the USB-C cable. HAS_BATTERY is 0,
 *    so the battery check is skipped (and GPIO1 is never read: an empty pin reads
 *    random voltages). Leave the 5V pin and GPIO1 empty; the two 100 kΩ resistors
 *    are not used.
 *
 *  ──────────────────────────────── ARDUINO IDE ───────────────────────────────
 *    Same settings as the real sensor code:
 *    Tools → Board:           "ESP32C3 Dev Module"
 *    Tools → USB CDC On Boot: "Enabled"   (this sketch refuses to build without it)
 *    Tools → Flash Mode:      "DIO"
 *    Libraries:               "Adafruit AHTX0" and "BH1750" by Christopher Laws
 *    Upload, then open Tools → Serial Monitor at 115200 baud straight away.
 *    Missed the start? Press RST on the board to run it again.
 *    If the upload won't start: hold BOOT, tap RST, let go of BOOT, upload again.
 *
 *  ═══════════════════════════ WIRING (no battery) ════════════════════════════
 *
 *  YOU NEED  ESP32-C3 Super Mini · AHT10 board · BH1750 board (GY-302) ·
 *            capacitive soil probe v1.2 with its 3-wire cable · a breadboard ·
 *            about 12 jumper wires · a USB-C DATA cable (some cables only charge)
 *
 *  BEFORE YOU START
 *    • Unplug the USB while you wire.
 *    • The AHT10 and BH1750 usually come with their header pins loose. SOLDER
 *      them. Pins only pushed through the holes touch on and off, which shows up
 *      as "NOT FOUND" one minute and fine the next.
 *    • Go by the LABELS printed next to each pin, never by position: boards differ
 *      and some are mirrored. On the BH1750 and most AHT10 boards SCL comes
 *      BEFORE SDA in the row.
 *
 *  THE IDEA
 *    The board has ONE 3V3 pin and ONE GND pin, but three parts need them. So the
 *    breadboard's two long side strips become a "3V3 rail" and a "GND rail", and
 *    every part takes its power from those. The two sensor boards share the same
 *    two data wires (I²C): both SDA pins go to GPIO6, both SCL pins to GPIO7.
 *
 *    ESP32-C3 Super Mini, USB-C at the top, chip side facing you
 *    (pin positions as on most boards — the printed labels are what counts):
 *
 *                         ┌────[ USB-C ]────┐
 *  (empty)            5V ─┤●               ●├─ GPIO5  (empty)
 *  GND rail ──────   GND ─┤●               ●├─ GPIO6  ────── SDA: AHT10 SDA + BH1750 SDA
 *  3V3 rail ──────   3V3 ─┤●               ●├─ GPIO7  ────── SCL: AHT10 SCL + BH1750 SCL
 *  (empty)         GPIO4 ─┤●               ●├─ GPIO8  (empty · on-board LED)
 *  probe AOUT ──── GPIO3 ─┤●               ●├─ GPIO9  (empty · BOOT button)
 *  (empty)         GPIO2 ─┤●               ●├─ GPIO10 ────── probe VCC
 *  (empty)         GPIO1 ─┤●               ●├─ GPIO20 (empty)
 *  (empty)         GPIO0 ─┤●               ●├─ GPIO21 (empty)
 *                         └─────────────────┘
 *
 *    Each part's pins:
 *
 *      AHT10                 BH1750 (GY-302)        SOIL PROBE v1.2
 *      VIN  →  3V3 rail      VCC  →  3V3 rail       GND  (black)   →  GND rail
 *      GND  →  GND rail      GND  →  GND rail       VCC  (red)     →  GPIO10
 *      SCL  →  GPIO7         SCL  →  GPIO7          AOUT (yellow)  →  GPIO3
 *      SDA  →  GPIO6         SDA  →  GPIO6
 *                            ADDR →  nothing
 *
 *    What ends up joined (everything on one line is one connection):
 *
 *      3V3 rail :  board 3V3 · AHT10 VIN · BH1750 VCC
 *      GND rail :  board GND · AHT10 GND · BH1750 GND · probe GND
 *      GPIO6    :  AHT10 SDA · BH1750 SDA
 *      GPIO7    :  AHT10 SCL · BH1750 SCL
 *      GPIO10   :  probe VCC
 *      GPIO3    :  probe AOUT
 *
 *  WIRE BY WIRE (tick them off)
 *     #   FROM                        TO                      NOTES
 *     1   board 3V3                   3V3 rail (+)            use a red wire
 *     2   board GND                   GND rail (−)            use a black wire
 *     3   AHT10 VIN (or VCC)          3V3 rail
 *     4   AHT10 GND                   GND rail
 *     5   AHT10 SDA                   board GPIO6
 *     6   AHT10 SCL                   board GPIO7
 *     7   BH1750 VCC                  3V3 rail
 *     8   BH1750 GND                  GND rail
 *     9   BH1750 SDA                  board GPIO6             same pin as wire 5
 *    10   BH1750 SCL                  board GPIO7             same pin as wire 6
 *    11   BH1750 ADDR                 NOTHING                 leave it empty (→ address 0x23)
 *    12   probe GND  (black)          GND rail
 *    13   probe VCC  (red)            board GPIO10            NOT 3V3, NOT 5V: the firmware
 *                                                             switches the probe on only to read
 *    14   probe AOUT (yellow/blue)    board GPIO3
 *    Cable colours vary — check the GND / VCC / AOUT labels on the probe's socket.
 *
 *    Two wires on one pin (GPIO6, GPIO7): push the board into the breadboard
 *    across the middle gap. The holes in the same short row as a pin are joined
 *    to it, so plug both SDA wires into GPIO6's row and both SCL wires into
 *    GPIO7's row. No free hole left? Run one short wire from that row to an empty
 *    row and use that.
 *
 *    The parts: keep the AHT10 a few centimetres from the ESP32 board (the board
 *    warms it a little), the BH1750's sensor window facing up and uncovered, and
 *    the probe out of the soil, clean and dry, for this test.
 *
 *  LAST CHECK BEFORE PLUGGING IN
 *    • Nothing on the 5V pin. • No wire joins the 3V3 rail to the GND rail.
 *    • The probe's red wire is on GPIO10. Then plug the USB-C into the computer.
 *
 *  ══════════════════════════════════════════════════════════════════════════
 */

#if !defined(CONFIG_IDF_TARGET_ESP32C3)
#error "This sketch is for the ESP32-C3. Tools → Board → ESP32C3 Dev Module."
#endif
#if !ARDUINO_USB_CDC_ON_BOOT
#error "Tools → USB CDC On Boot → Enabled. Without it the results go to pins 20/21 and the Serial Monitor stays blank."
#endif

// ─────────── settings ───────────
#define TEST_VERSION   "t1.0"
#define HAS_BATTERY    0      // 0 = no battery, USB power only (the normal case). 1 ONLY with the
                              //   two-resistor divider on GPIO1 — then the battery is checked too.
#define GUIDED_TESTS   1      // 1 = 4 hands-on checks (cover the light sensor, breathe on the AHT10,
                              //   wet the probe, press BOOT). 0 = automatic checks only.
#define WIFI_SCAN      1      // 1 = check the Wi-Fi radio by listing nearby networks (joins nothing)
#define GUIDE_SECONDS  20     // how long each hands-on check waits for you
#define LIVE_EVERY_MS  1500   // after the test: a live reading this often

// Pins and settings: the SAME as the real sensor code, so this tests what it will use.
#define SOIL_PIN        3     // ADC1_CH3
#define BAT_PIN         1     // ADC1_CH1 — only read when HAS_BATTERY is 1
#define I2C_SDA         6
#define I2C_SCL         7
#define BOOT_BTN        9
#define SENSOR_PWR      10    // powers the soil probe
#define AHT_ADDR        0x38
#define AHT_ADDR_ALT    0x39  // AHT10 with its address pad set high — the real code won't find it
#define BH1750_ADDR     0x23
#define BH1750_ADDR_ALT 0x5C  // BH1750 with ADDR wired high — the real code won't find it
#define SOIL_WARMUP_MS  600
#define WIFI_TX_POWER   WIFI_POWER_8_5dBm
#define BAT_DIVIDER     2.0f

// What a probe should read (the app's factory scale, lib/sensing/autoCalibration.ts):
// about 3020 in dry air and 1400 in water; below 200 the app reports "probe disconnected".
#define SOIL_AIR_TYPICAL   3020
#define SOIL_WATER_TYPICAL 1400
#define SOIL_DISCONNECTED  200
#define SOIL_AIR_LOW       1500   // lower than this in air: wet, in soil, or a weak probe

#include <stdarg.h>
#include <Wire.h>
#include <WiFi.h>
#include <Adafruit_AHTX0.h>
#include <BH1750.h>
#include <esp_system.h>
#include <esp_flash.h>

// ─────────── results ───────────
enum Status : uint8_t { PASS, WARN, FAIL, SKIP };
struct Result { const char* name; Status st; String detail; String fix; };
struct Adc { int med, lo, hi; };                 // a soil reading: median and the range of 9 samples
Result results[14];
int nResults = 0;

const char* label(Status s){
  return s == PASS ? "PASS" : s == WARN ? "WARN" : s == FAIL ? "FAIL" : "SKIP";
}

String fmt(const char* f, ...){
  char buf[256];
  va_list ap;
  va_start(ap, f);
  vsnprintf(buf, sizeof buf, f, ap);
  va_end(ap);
  return String(buf);
}

void report(const char* name, Status st, const String& detail, const String& fix = String()){
  if (nResults < (int)(sizeof(results) / sizeof(results[0]))) results[nResults++] = { name, st, detail, fix };
  Serial.printf("  %s  %-16s %s\n", label(st), name, detail.c_str());
  if (st != PASS && fix.length()) Serial.printf("        Fix: %s\n", fix.c_str());
}

void section(const char* title){ Serial.printf("\n── %s ──\n", title); }

// ─────────── state ───────────
Adafruit_AHTX0 aht;
BH1750 lightMeter(BH1750_ADDR);
bool ahtOk = false, bhOk = false, soilOk = false;
bool soilSticky = false;              // probe unpowered but its output did not drain by itself
int  soilAir = -1;                    // the probe's reading in air, from the soil test
uint8_t found[16];                    // I²C addresses that answered
int nFound = 0;
volatile bool bootPressed = false;
void IRAM_ATTR onBootButton(){ bootPressed = true; }

// ─────────── sensor reads (as in the real code) ───────────
// 9 samples: the median is the reading, lo–hi shows how much it jumps.
Adc readAdc(int pin){
  int s[9];
  for (int i = 0; i < 9; i++){ s[i] = analogRead(pin); delay(15); }
  for (int i = 1; i < 9; i++){
    int k = s[i], j = i - 1;
    while (j >= 0 && s[j] > k){ s[j + 1] = s[j]; j--; }
    s[j + 1] = k;
  }
  return { s[4], s[0], s[8] };
}

bool readClimate(float* t, float* h){
  sensors_event_t he, te;
  if (!aht.getEvent(&he, &te)) return false;
  if (isnan(te.temperature) || isnan(he.relative_humidity)) return false;
  *t = te.temperature; *h = he.relative_humidity;
  return true;
}

float measureLuxOnce(){
  lightMeter.configure(BH1750::ONE_TIME_HIGH_RES_MODE);
  uint32_t t0 = millis();
  while (!lightMeter.measurementReady(true)){
    if (millis() - t0 > 1000) break;
    delay(5);
  }
  return lightMeter.readLightLevel();            // negative = I2C error
}

// −1 on error. Above 40 000 lux it re-reads at the short integration time, like the real code.
float readLux(){
  float lux = measureLuxOnce();
  if (lux < 0) return -1;
  if (lux > 40000.0f && lightMeter.setMTreg(BH1750_MTREG_MIN)){
    float bright = measureLuxOnce();
    if (bright >= 0) lux = bright;
    lightMeter.setMTreg(BH1750_DEFAULT_MTREG);
  }
  return lux;
}

// ─────────── 1. board and power ───────────
const char* resetName(esp_reset_reason_t r){
  switch (r){
    case ESP_RST_POWERON:  return "power on";
    case ESP_RST_SW:       return "restart";
    case ESP_RST_EXT:      return "RST button";
    case ESP_RST_DEEPSLEEP:return "wake from sleep";
    case ESP_RST_BROWNOUT: return "BROWNOUT (power dipped)";
    case ESP_RST_PANIC:    return "crash";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return "watchdog";
    default:               return "other";
  }
}

void testBoard(){
  esp_reset_reason_t why = esp_reset_reason();
  uint32_t flash = 0;
  if (esp_flash_get_physical_size(NULL, &flash) != ESP_OK) flash = ESP.getFlashChipSize();
  unsigned mb = (unsigned)(flash / (1024UL * 1024UL));
  unsigned rev = ESP.getChipRevision();
  Serial.printf("  started by: %s · CPU %u MHz · free memory %u KB\n",
                resetName(why), (unsigned)ESP.getCpuFreqMHz(), (unsigned)(ESP.getFreeHeap() / 1024));

  if (mb < 4)
    report("Board", FAIL, fmt("%s v%u.%u · only %u MB flash", ESP.getChipModel(), rev / 100, rev % 100, mb),
           "The real sensor code needs a board with 4 MB of flash (the ESP32-C3 Super Mini has 4 MB).");
  else
    report("Board", PASS, fmt("%s v%u.%u · %u MB flash", ESP.getChipModel(), rev / 100, rev % 100, mb));

  if (why == ESP_RST_BROWNOUT)
    report("USB power", FAIL, "the board browned out: its supply dipped too low",
           "Use another USB-C cable or another USB port on the computer — not an unpowered hub. "
           "Check nothing joins the 3V3 rail to the GND rail.");
  else
    report("USB power", PASS, String(HWCDC::isPlugged() ? "from a computer" : "USB") +
           " · no battery needed");
}

void testBattery(){
#if HAS_BATTERY
  analogSetPinAttenuation(BAT_PIN, ADC_11db);
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++){ sum += analogReadMilliVolts(BAT_PIN); delay(2); }
  int mv = (int)lroundf((sum / 16.0f) * BAT_DIVIDER);
  if (mv < 2500)
    report("Battery", FAIL, fmt("%d mV — no battery seen", mv),
           "HAS_BATTERY is 1 but no cell is measured. Running from USB only? Set HAS_BATTERY 0 here AND "
           "in greenr_sensor_c3 — an empty GPIO1 reads random voltages.");
  else if (mv > 4350)
    report("Battery", FAIL, fmt("%d mV — too high for one lithium cell", mv),
           "The two divider resistors must be equal (100 kΩ + 100 kΩ), midpoint to GPIO1.");
  else if (mv < 3400)
    report("Battery", WARN, fmt("%d mV — low", mv),
           "Charge it. Below 3.40 V the real sensor skips Wi-Fi to protect the cell.");
  else
    report("Battery", PASS, fmt("%d mV", mv));
#else
  report("Battery", SKIP, "none fitted (HAS_BATTERY 0) — USB power is all it needs");
#endif
}

// ─────────── 2. I²C wiring ───────────
// Is something pulling this line up? The sensor boards carry pull-up resistors, so with
// a powered board attached the line reads HIGH even against the chip's weak pull-down.
bool lineHigh(int pin){
  pinMode(pin, INPUT_PULLDOWN);
  delay(5);
  int high = 0;
  for (int i = 0; i < 5; i++){ high += digitalRead(pin); delay(1); }
  pinMode(pin, INPUT);
  return high >= 4;
}

int scanBus(){
  nFound = 0;
  for (uint8_t a = 0x08; a <= 0x77; a++){
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0 && nFound < (int)sizeof(found)) found[nFound++] = a;
  }
  return nFound;
}

bool onBus(uint8_t a){
  for (int i = 0; i < nFound; i++) if (found[i] == a) return true;
  return false;
}

const char* nameOf(uint8_t a){
  switch (a){
    case AHT_ADDR:        return "AHT10";
    case AHT_ADDR_ALT:    return "AHT10 (wrong address)";
    case BH1750_ADDR:     return "BH1750";
    case BH1750_ADDR_ALT: return "BH1750 (wrong address)";
    default:              return "unknown";
  }
}

void startBus(int sda, int scl){
  Wire.begin(sda, scl, 100000);
  Wire.setTimeOut(20);
}

void testI2C(){
  bool sda = lineHigh(I2C_SDA), scl = lineHigh(I2C_SCL);
  startBus(I2C_SDA, I2C_SCL);
  scanBus();

  String list;
  for (int i = 0; i < nFound; i++) list += fmt("0x%02X %s  ", found[i], nameOf(found[i]));
  Serial.printf("  SDA (GPIO6) %s · SCL (GPIO7) %s · answering: %s\n",
                sda ? "pulled up" : "NOT pulled up", scl ? "pulled up" : "NOT pulled up",
                nFound ? list.c_str() : "nothing");

  if (nFound == 0){
    // Nobody answers. Try the wires the other way round before blaming the sensors.
    Wire.end();
    startBus(I2C_SCL, I2C_SDA);
    int swapped = scanBus();
    Wire.end();
    startBus(I2C_SDA, I2C_SCL);
    nFound = 0;                                  // unusable as wired, whatever the swapped scan saw
    if (swapped)
      report("I2C wiring", FAIL, "SDA and SCL are swapped",
             "Swap the wires on GPIO6 and GPIO7: every SDA goes to GPIO6, every SCL to GPIO7.");
    else if (!sda && !scl)
      report("I2C wiring", FAIL, "no sensor board has power, or none is connected",
             "Board 3V3 → 3V3 rail, board GND → GND rail; AHT10 VIN and BH1750 VCC → 3V3 rail; "
             "both their GNDs → GND rail.");
    else if (!sda || !scl)
      report("I2C wiring", FAIL, fmt("%s reaches no sensor board", !sda ? "GPIO6 (SDA)" : "GPIO7 (SCL)"),
             !sda ? "Check the SDA wires: AHT10 SDA and BH1750 SDA → GPIO6."
                  : "Check the SCL wires: AHT10 SCL and BH1750 SCL → GPIO7.");
    else
      report("I2C wiring", FAIL, "the boards have power but neither answers",
             "Check SDA → GPIO6 and SCL → GPIO7 at BOTH ends, and solder the boards' header pins.");
    return;
  }

  String problem, fix;
  if (onBus(BH1750_ADDR_ALT)){
    problem += "BH1750 answers at 0x5C (its ADDR pin is wired high). ";
    fix += "Unplug the BH1750's ADDR wire — the real code looks for it at 0x23. ";
  }
  if (onBus(AHT_ADDR_ALT)){
    problem += "AHT10 answers at 0x39. ";
    fix += "Its address pad is bridged high; the real code expects 0x38 — undo the bridge or use another AHT10. ";
  }
  if (problem.length()) report("I2C wiring", FAIL, problem, fix);
  else                  report("I2C wiring", PASS, "SDA and SCL OK · " + list);
}

// ─────────── 3. AHT10 ───────────
float ahtT = NAN, ahtH = NAN;

void testAht(){
  uint8_t addr = onBus(AHT_ADDR) ? AHT_ADDR : onBus(AHT_ADDR_ALT) ? AHT_ADDR_ALT : 0;
  if (!addr){
    report("AHT10", FAIL, "not found",
           "VIN → 3V3 rail, GND → GND rail, SDA → GPIO6, SCL → GPIO7. Solder its header pins.");
    return;
  }
  if (!aht.begin(&Wire, 0, addr)){
    report("AHT10", FAIL, fmt("answers at 0x%02X but will not start", addr),
           "Unplug the USB for 5 s and try again. Still failing? Test it alone: unplug the BH1750's "
           "SDA and SCL — some AHT10s misbehave on a shared bus.");
    return;
  }
  int ok = 0;
  float tLo = 1e9, tHi = -1e9, hLo = 1e9, hHi = -1e9;
  for (int i = 0; i < 5; i++){
    float t, h;
    if (readClimate(&t, &h)){
      ok++; ahtT = t; ahtH = h;
      tLo = min(tLo, t); tHi = max(tHi, t); hLo = min(hLo, h); hHi = max(hHi, h);
    }
    delay(300);
  }
  if (!ok){
    report("AHT10", FAIL, "starts, but every reading failed",
           "A loose SDA, SCL or power wire — solder or reseat the AHT10's pins.");
    return;
  }
  if (ahtH < 0.5f || ahtH > 99.5f || ahtT < -20 || ahtT > 70){
    report("AHT10", FAIL, fmt("reads %.1f °C, %.1f %%RH — impossible indoors", ahtT, ahtH),
           "A stuck AHT10 reads 0 %RH or −50 °C. Unplug the USB for 5 s; if it repeats, replace the AHT10.");
    return;
  }
  ahtOk = true;
  if (ok < 5)
    report("AHT10", WARN, fmt("%.1f °C · %.1f %%RH, but %d of 5 readings failed", ahtT, ahtH, 5 - ok),
           "Usually a loose wire — solder or reseat the AHT10's pins.");
  else if (tHi - tLo > 1.5f || hHi - hLo > 5)
    report("AHT10", WARN, fmt("%.1f °C · %.1f %%RH, but it jumped %.1f–%.1f °C, %.1f–%.1f %%RH in 1.5 s",
                              ahtT, ahtH, tLo, tHi, hLo, hHi),
           "Usually a loose wire — solder or reseat the AHT10's pins.");
  else
    report("AHT10", PASS, fmt("%.1f °C · %.1f %%RH", ahtT, ahtH));
}

// ─────────── 4. BH1750 ───────────
float bhLux = -1;

void testBh(){
  uint8_t addr = onBus(BH1750_ADDR) ? BH1750_ADDR : onBus(BH1750_ADDR_ALT) ? BH1750_ADDR_ALT : 0;
  if (!addr){
    report("BH1750", FAIL, "not found",
           "VCC → 3V3 rail, GND → GND rail, SDA → GPIO6, SCL → GPIO7, ADDR → nothing. Its pins read "
           "VCC GND SCL SDA ADDR — SCL comes first, go by the labels. Solder its header pins.");
    return;
  }
  if (!lightMeter.begin(BH1750::ONE_TIME_HIGH_RES_MODE, addr, &Wire)){
    report("BH1750", FAIL, fmt("answers at 0x%02X but will not start", addr),
           "Reseat its wires, unplug the USB for 5 s and try again.");
    return;
  }
  int ok = 0;
  for (int i = 0; i < 3; i++){
    float l = readLux();
    if (l >= 0){ ok++; bhLux = l; }
  }
  if (!ok){
    report("BH1750", FAIL, "starts, but every reading failed",
           "A loose SDA or SCL wire — solder or reseat the BH1750's pins.");
    return;
  }
  bhOk = true;
  if (ok < 3)
    report("BH1750", WARN, fmt("%.0f lux, but %d of 3 readings failed", bhLux, 3 - ok),
           "Usually a loose wire — solder or reseat the BH1750's pins.");
  else
    report("BH1750", PASS, fmt("%.0f lux%s", bhLux, bhLux > 40000 ? " (very bright — extended range used)" : ""));
}

// ─────────── 5. soil probe ───────────
void testSoil(){
  // Probe OFF first. Its output holds a charge for a moment, so wait until it has drained.
  digitalWrite(SENSOR_PWR, LOW);
  Adc off = readAdc(SOIL_PIN);
  for (int i = 0; i < 10 && off.med > 300; i++){ delay(300); off = readAdc(SOIL_PIN); }

  // Still high? Either the probe is powered from somewhere else (VCC not on GPIO10), or it
  // is unpowered but holding its charge. Drain the pin with the chip's pull-down and look
  // again: a held charge drains to ~0, a powered probe drives the pin straight back up.
  int drained = -1;
  if (off.med >= 400){
    pinMode(SOIL_PIN, INPUT_PULLDOWN);
    delay(300);
    pinMode(SOIL_PIN, INPUT);                    // pull-down off again: it would drag later readings down
    analogSetPinAttenuation(SOIL_PIN, ADC_11db); // and the pin back to the ADC, as set up in setup()
    drained = readAdc(SOIL_PIN).med;
    if (drained < 400) soilSticky = true;
  }

  // Probe ON through GPIO10, exactly as the real code reads it.
  digitalWrite(SENSOR_PWR, HIGH);
  delay(SOIL_WARMUP_MS);
  Adc on = readAdc(SOIL_PIN);
  int mv = analogReadMilliVolts(SOIL_PIN);
  delay(1000);
  Adc on2 = readAdc(SOIL_PIN);
  digitalWrite(SENSOR_PWR, LOW);

  int spread = max(on.hi - on.lo, on2.hi - on2.lo);
  int drift  = abs(on2.med - on.med);
  bool switched = off.med < 400 || off.med < on.med / 3 || soilSticky;
  Serial.printf("  power off: %d%s · power on: %d (%.2f V), then %d · jumps by up to %d\n",
                off.med, drained >= 0 ? fmt(" (drained: %d)", drained).c_str() : "",
                on.med, mv / 1000.0f, on2.med, spread);

  if (on.med < SOIL_DISCONNECTED){
    report("Soil probe", FAIL, fmt("no signal (reads %d)", on.med),
           "AOUT → GPIO3, VCC → GPIO10, GND → GND rail. If all three are right, look at the 8-pin chip "
           "on the probe: TLC555 works on 3.3 V; NE555 needs 5 V and reads nothing here — use another probe.");
    return;
  }
  if (abs(on.med - off.med) < 100 && spread > 150){
    report("Soil probe", FAIL, fmt("GPIO3 is floating (reads jump %d–%d)", on.lo, on.hi),
           "The probe's AOUT wire isn't reaching GPIO3 — reseat both ends.");
    return;
  }
  soilOk = true;
  soilAir = on2.med;
  if (!switched)
    report("Soil probe", WARN, fmt("reads %d, but stays powered with GPIO10 off (%d)", on2.med, off.med),
           "Its VCC (red) wire is on 3V3 or 5V. Move it to GPIO10: the real code powers the probe only "
           "while it reads.");
  else if (spread > 120 || drift > 150)
    report("Soil probe", WARN, fmt("reads %d, but jumps by %d", on2.med, max(spread, drift)),
           "A loose AOUT or GND wire — push the probe's connector fully home and keep the probe still.");
  else if (soilSticky)
    report("Soil probe", WARN, fmt("reads %d, but holds its reading with the power off", on2.med),
           "Wiring is right. Some cheap probes lack the resistor that lets the reading fall, so it "
           "sticks and never shows the soil getting wetter. The water check below tells you for sure.");
  else if (on2.med >= 4090)
    report("Soil probe", WARN, "at the top of the scale (4095)",
           "Some probes do this in dry air. If it stays at 4095 in the water check below, check the "
           "probe's GND wire, and that AOUT isn't touching 3V3.");
  else if (on2.med < SOIL_AIR_LOW)
    report("Soil probe", WARN, fmt("reads %d — low for a probe in air", on2.med),
           "Is it in soil or wet? Take it out, wipe it dry and press RST. In dry air most probes read "
           "2000–3500 (water about 1400).");
  else
    report("Soil probe", PASS, fmt("%d in air (%.2f V) · power switched by GPIO10 · steady", on2.med, mv / 1000.0f));
}

// ─────────── 6. Wi-Fi radio ───────────
void testWifi(){
#if WIFI_SCAN
  WiFi.persistent(false);                        // touch no saved Wi-Fi settings
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_TX_POWER);                // the real code's power setting
  int16_t n = WiFi.scanNetworks();
  if (n <= 0){
    report("Wi-Fi radio", FAIL, n == 0 ? "no networks seen" : "scan failed",
           "Move closer to the router and press RST. Only 2.4 GHz networks show (the C3 can't use 5 GHz). "
           "If none ever show, the board's antenna is faulty.");
  } else {
    int idx[40];
    int m = min((int)n, 40);
    for (int i = 0; i < m; i++) idx[i] = i;
    for (int i = 1; i < m; i++){                 // strongest first
      int k = idx[i], j = i - 1;
      while (j >= 0 && WiFi.RSSI(idx[j]) < WiFi.RSSI(k)){ idx[j + 1] = idx[j]; j--; }
      idx[j + 1] = k;
    }
    for (int i = 0; i < min(m, 8); i++){
      String ssid = WiFi.SSID(idx[i]);
      Serial.printf("      %4d dBm  ch %2d  %s\n", (int)WiFi.RSSI(idx[i]), (int)WiFi.channel(idx[i]),
                    ssid.length() ? ssid.c_str() : "(hidden)");
    }
    if (n > 8) Serial.printf("      … and %d more\n", n - 8);
    Serial.println("      Your home Wi-Fi must be in this list. Weaker than -80 dBm will be unreliable.");
    report("Wi-Fi radio", PASS, fmt("%d networks · strongest %d dBm", (int)n, (int)WiFi.RSSI(idx[0])));
  }
  WiFi.scanDelete();
  WiFi.mode(WIFI_OFF);
#else
  report("Wi-Fi radio", SKIP, "WIFI_SCAN is 0");
#endif
}

// ─────────── 7. hands-on checks ───────────
bool timeLeft(uint32_t t0){ return millis() - t0 < GUIDE_SECONDS * 1000UL; }

void guideLight(){
  if (!bhOk){ report("Light reacts", SKIP, "BH1750 not working"); return; }
  Serial.printf("\n  ▶ LIGHT: cover the BH1750 with your finger — or, in a dark room, shine your phone's "
                "torch on it. (%d s)\n", GUIDE_SECONDS);
  float base = readLux(), now = base;
  if (base < 0){ report("Light reacts", WARN, "reading failed", "Reseat the BH1750's wires."); return; }
  bool ok = false;
  uint32_t t0 = millis(), shown = 0;
  while (timeLeft(t0)){
    float l = readLux();
    if (l >= 0) now = l;
    if (millis() - shown >= 1000){ shown = millis(); Serial.printf("      %.0f lux\n", now); }
    if ((base >= 10 && now <= base * 0.5f) || now >= base * 2 + 20){ ok = true; break; }
    delay(100);
  }
  if (ok) report("Light reacts", PASS, fmt("%.0f → %.0f lux", base, now));
  else    report("Light reacts", WARN, fmt("no change seen (%.0f lux)", now),
                 "Missed it? Press RST to run again. If you did cover it, the BH1750 isn't sensing.");
}

void guideBreath(){
  if (!ahtOk){ report("Humidity reacts", SKIP, "AHT10 not working"); return; }
  Serial.printf("\n  ▶ HUMIDITY: breathe slowly onto the AHT10 from close up, 3 or 4 breaths. (%d s)\n",
                GUIDE_SECONDS);
  float t0v, h0v, t = NAN, h = NAN;
  if (!readClimate(&t0v, &h0v)){ report("Humidity reacts", WARN, "reading failed", "Reseat the AHT10's wires."); return; }
  t = t0v; h = h0v;
  bool ok = false;
  uint32_t t0 = millis(), shown = 0;
  while (timeLeft(t0)){
    float a, b;
    if (readClimate(&a, &b)){ t = a; h = b; }
    if (millis() - shown >= 1000){ shown = millis(); Serial.printf("      %.1f %%RH  %.1f °C\n", h, t); }
    if (h - h0v >= 3.0f || t - t0v >= 1.0f){ ok = true; break; }
    delay(400);
  }
  if (ok) report("Humidity reacts", PASS, fmt("%.1f → %.1f %%RH", h0v, h));
  else    report("Humidity reacts", WARN, fmt("no change seen (%.1f %%RH)", h),
                 "Missed it? Press RST to run again. If you did breathe on it, the AHT10 isn't sensing.");
}

void guideProbe(){
  if (!soilOk){ report("Probe reacts", SKIP, "soil probe not working"); return; }
  Serial.printf("\n  ▶ SOIL PROBE: dip it in a glass of water up to its line (keep the electronics at the top "
                "dry) — or grip its lower half firmly in your fist. (%d s)\n", GUIDE_SECONDS);
  digitalWrite(SENSOR_PWR, HIGH);
  delay(SOIL_WARMUP_MS);
  int base = soilAir, now = readAdc(SOIL_PIN).med;
  int need = max(base / 10, 150);
  bool ok = false;
  uint32_t t0 = millis(), shown = 0;
  while (timeLeft(t0)){
    now = readAdc(SOIL_PIN).med;
    if (millis() - shown >= 1000){ shown = millis(); Serial.printf("      soil %d\n", now); }
    if (abs(now - base) >= need){ ok = true; break; }
  }
  if (ok){ delay(1500); now = readAdc(SOIL_PIN).med; }   // let it settle for the reported value
  digitalWrite(SENSOR_PWR, LOW);
  if (ok) report("Probe reacts", PASS, fmt("%d → %d (%s)", base, now, now < base ? "lower = wetter" : "higher = drier"));
  else    report("Probe reacts", WARN, fmt("no change seen (%d)", now),
                 soilSticky ? "If you did wet it: this probe's reading sticks (see Soil probe above) — "
                              "it can't show watering. Use another probe."
                            : "Missed it? Press RST to run again. If you did wet it, the probe isn't "
                              "sensing — check AOUT.");
  if (ok) Serial.println("      Wipe the probe dry.");
}

void guideBoot(){
  Serial.printf("\n  ▶ BOOT BUTTON: press and release the small button marked BOOT (or B) — not RST. (%d s)\n",
                GUIDE_SECONDS);
  bool ok = false;
  uint32_t t0 = millis();
  while (timeLeft(t0)){
    if (digitalRead(BOOT_BTN) == LOW){ ok = true; break; }
    delay(10);
  }
  uint32_t r0 = millis();
  while (ok && digitalRead(BOOT_BTN) == LOW && millis() - r0 < 10000) delay(10);
  if (ok) report("BOOT button", PASS, "works (the real sensor uses it to forget its Wi-Fi)");
  else    report("BOOT button", WARN, "not pressed in time",
                 "Missed it? Press RST to run again. The real sensor uses this button to forget its Wi-Fi.");
}

// ─────────── summary ───────────
void printSummary(){
  int fails = 0, warns = 0;
  Serial.println("\n==================== RESULT ====================");
  for (int i = 0; i < nResults; i++){
    const Result& r = results[i];
    Serial.printf("  %s  %-16s %s\n", label(r.st), r.name, r.detail.c_str());
    if (r.st != PASS && r.fix.length()) Serial.printf("        Fix: %s\n", r.fix.c_str());
    if (r.st == FAIL) fails++;
    if (r.st == WARN) warns++;
  }
  Serial.println("------------------------------------------------");
  if (fails)
    Serial.printf("  %d thing%s to fix (FAIL). Unplug the USB, fix the wiring, plug in again.\n",
                  fails, fails == 1 ? "" : "s");
  else if (warns)
    Serial.printf("  The hardware works. %d note%s (WARN) above — worth a look, not a blocker.\n",
                  warns, warns == 1 ? "" : "s");
  else
    Serial.println("  ALL HARDWARE OK.");
  if (!fails)
    Serial.println("  Next: upload firmware/greenr_sensor_c3/greenr_sensor_c3.ino — the real sensor code.");
  Serial.println("  RST = run the whole test again · BOOT = show this result again");
  Serial.println("================================================");
}

// ─────────── live view ───────────
void printLive(){
  static int lines = 0;
  if (lines++ % 20 == 0)
    Serial.printf("\nLIVE — soil: lower = wetter (air about %d, water about %d)\n",
                  soilAir > 0 ? soilAir : SOIL_AIR_TYPICAL,
                  soilAir > 0 ? (int)lroundf(soilAir * (float)SOIL_WATER_TYPICAL / SOIL_AIR_TYPICAL)
                              : SOIL_WATER_TYPICAL);
  String soil = "--", lux = "--", clim = "--";
  if (soilOk) soil = String(readAdc(SOIL_PIN).med);
  if (bhOk){ float l = readLux(); if (l >= 0) lux = fmt("%.0f lux", l); }
  if (ahtOk){ float t, h; if (readClimate(&t, &h)) clim = fmt("%.1f °C · %.1f %%RH", t, h); }
  Serial.printf("  soil %s · %s · %s\n", soil.c_str(), lux.c_str(), clim.c_str());
}

void setup(){
  pinMode(SENSOR_PWR, OUTPUT);
  digitalWrite(SENSOR_PWR, LOW);                 // probe off first: the soil test starts from "off"
  pinMode(BOOT_BTN, INPUT_PULLUP);
  analogReadResolution(12);                      // 0–4095, as in the real code
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);

  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 10000) delay(10);
  delay(1500);                                   // time for the Serial Monitor to attach

  Serial.printf("\n\n===== greenr sensor HARDWARE TEST %s =====\n", TEST_VERSION);
  Serial.println("Checks the wiring and every sensor. Uploads nothing, changes no settings.");
  Serial.println("Keep the probe OUT of the soil, clean and dry. Starting in 3 s…");
  delay(3000);

  section("1. Board and power");                       testBoard(); testBattery();
  section("2. Sensor wiring — I2C: GPIO6 = SDA, GPIO7 = SCL"); testI2C();
  section("3. AHT10 — temperature and humidity");      testAht();
  section("4. BH1750 — light");                        testBh();
  section("5. Soil probe — AOUT on GPIO3, power from GPIO10"); testSoil();
  section("6. Wi-Fi radio");                           testWifi();
#if GUIDED_TESTS
  section(fmt("7. Your turn — 4 quick checks, %d s each (just wait to skip one)", GUIDE_SECONDS).c_str());
  guideLight();
  guideBreath();
  guideProbe();
  guideBoot();
#endif
  printSummary();

  if (soilOk) digitalWrite(SENSOR_PWR, HIGH);    // live view: probe stays on so it reacts at once
  bootPressed = false;
  attachInterrupt(BOOT_BTN, onBootButton, FALLING);
}

void loop(){
  static uint32_t last = 0, lastPress = 0;
  if (bootPressed){
    bootPressed = false;
    if (millis() - lastPress > 1000){            // a button bounces: one press, one summary
      lastPress = millis();
      printSummary();
    }
  }
  if (millis() - last >= LIVE_EVERY_MS){
    last = millis();
    printLive();
  }
  delay(20);
}
