# Greenr hardware

What the sensor is, how it is wired, what each part can and cannot measure, and
what to add next.

**Nothing here was physically inspected or tested.** It is drawn from the
firmware in this repository, the app's conversion code, and the parts' published
characteristics. The ESP32-C3 firmware has been compiled against the ESP32
Arduino core 3.3.12 with the exact settings below, in every configuration; it
has not been run on a board. Anything that needs a meter or the board in hand is
listed under "Needs physical verification".

---

## Current build: ESP32-C3 Super Mini

Firmware: [`firmware/greenr_sensor_c3/greenr_sensor_c3.ino`](../firmware/greenr_sensor_c3/greenr_sensor_c3.ino),
version `c3-1.0`. It uploads through `ingest_v2`, so run SQL file 14 (see
[DATABASE.md](DATABASE.md)) **before** flashing it.

| Part | Role |
|---|---|
| ESP32-C3 Super Mini | microcontroller, Wi-Fi |
| Capacitive soil moisture sensor (v1.2 type) | soil signal |
| BH1750 module (GY-302) | light, in lux |
| AHT10 module | air temperature and humidity |
| One lithium cell, 3.7 V nominal | power |
| Two equal resistors, 100 kΩ each (**optional**) | battery voltage divider, only for the battery % in the app. Fitted: set `HAS_BATTERY 1`. Not fitted: leave `HAS_BATTERY 0` (the default) |

The LDR from the previous build is gone: the BH1750 replaces it.

### Wiring

Pins follow the C3 map proposed in the previous version of this document. Use
the GPIO numbers **printed on the board**, not positions.

| Component | Component pin | ESP32-C3 connection | Voltage | Purpose |
|---|---|---|---|---|
| Soil sensor | AOUT | GPIO3 (ADC1_CH3) | 0 to about 3 V analog | soil signal, high = dry |
| | VCC | GPIO10 | 3.3 V, switched | powered only for the ~0.8 s of a reading |
| | GND | GND | | |
| AHT10 | SDA | GPIO6 | 3.3 V I²C | address 0x38 |
| | SCL | GPIO7 | 3.3 V I²C | |
| | VIN / VCC | 3V3 | 3.3 V | |
| | GND | GND | | |
| BH1750 | SDA | GPIO6 (shared with AHT10) | 3.3 V I²C | address 0x23 |
| | SCL | GPIO7 (shared with AHT10) | 3.3 V I²C | |
| | VCC | 3V3 | 3.3 V | |
| | GND | GND | | |
| | ADDR | not connected | | the module pulls it low → 0x23 |
| Battery divider (optional) | top resistor, 100 kΩ | battery + | up to 4.2 V | needs `HAS_BATTERY 1` |
| | midpoint | GPIO1 (ADC1_CH1) | up to 2.1 V | battery measurement |
| | bottom resistor, 100 kΩ | GND | | |
| Battery | + | 5V pin (through a charger/protection board if used) | 3.0–4.2 V | feeds the board's 3.3 V regulator |
| | − | GND | | |
| BOOT button | on the board | GPIO9 | | hold to forget Wi-Fi |
| RST button | on the board | EN | | restart; also takes a reading |

```
                  ESP32-C3 Super Mini (GPIO numbers as printed)
                 ┌───────────────────────────────┐
  battery + ─────┤ 5V                       GPIO5 ├
  all GND ───────┤ GND                      GPIO6 ├──── SDA: AHT10 + BH1750
  AHT10 + BH1750 ┤ 3V3                      GPIO7 ├──── SCL: AHT10 + BH1750
     VCC         │ GPIO4                    GPIO8 │     (LED, strapping — unused)
  soil AOUT ─────┤ GPIO3                    GPIO9 │     (BOOT button)
                 │ GPIO2 (strapping, unused)GPIO10├──── soil VCC (switched)
  divider mid ───┤ GPIO1                   GPIO20 │     (UART RX, unused)
                 │ GPIO0                   GPIO21 │     (UART TX, unused)
                 └───────────────────────────────┘

  battery + ──[100 kΩ]──┬──[100 kΩ]── GND
                        └──────────── GPIO1
```

Why these pins:

- **ADC1 only for analog** (GPIO0–4). ADC2 (GPIO5) stops working while Wi-Fi is on.
- **GPIO2, GPIO8 and GPIO9 are strapping pins**, sampled at reset to decide the boot
  mode. Nothing external is wired to them. GPIO9 is the on-board BOOT button;
  GPIO8 drives the on-board LED, which the firmware does not use.
- **GPIO18/19** are the USB lines and **GPIO20/21** the UART; left free.
- **One I²C bus** for both sensors. Their addresses differ (0x38, 0x23), and both
  modules carry pull-up resistors. Some AHT10 units are reported to misbehave on a
  shared bus; if the Serial Monitor says AHT10 or BH1750 "NOT FOUND" with the
  wiring correct, try the AHT10 alone to find out.

### Power

- The battery goes to the **5V pin**, which feeds the on-board 3.3 V regulator.
  **Never to the 3V3 pin**: a full cell is 4.2 V and the chip's limit is 3.6 V.
- **Unplug the battery before plugging in USB** to upload, unless your board or
  charger module keeps the two apart. On many Super Mini boards the 5V pin is
  joined to USB power, which would push 5 V into the cell.
- A cell without a protection circuit should not be run flat. With the divider
  fitted (`HAS_BATTERY 1`) the firmware stops using Wi-Fi below 3.40 V; without it
  the firmware cannot see the battery at all, so the app shows no battery level
  and nothing stops the cell running down. Either way a protected cell or a
  charger board with protection (TP4056 + DW01 type) is the safe choice, and
  without the divider it is required.
- Without the divider the firmware also cannot tell battery from USB, so the
  "greenr-setup" network stays open until setup is finished instead of closing
  after 20 minutes. Finish setup when you first power the sensor.
- If your battery is not a single lithium cell (for example 3 × AA), change
  `BAT_DIVIDER`, `BAT_CUTOFF_MV` and the percentage curve in SQL file 14.

**The red power LED** (on boards that have one) stays lit and draws roughly 1–3 mA,
far more than everything else does in deep sleep. Rough budget for a 3-hourly
sensor, from typical datasheet currents, not measured:

| | per day |
|---|---|
| 8 wakes × ~8 s × ~90 mA (Wi-Fi + TLS + upload) | ≈ 1.6 mAh |
| deep sleep: chip ≈ 5 µA, regulator ≈ 40–60 µA, divider 21 µA | ≈ 1.6–2.0 mAh |
| red power LED, if fitted, 1–3 mA | ≈ 24–72 mAh |

So a 1000 mAh cell lasts on the order of months without the LED, and weeks with
it. Removing the LED (or its resistor) is the single biggest battery saving.

### Arduino IDE

1. Boards Manager: install **esp32** by Espressif (version 3.x).
2. Tools → Board → **ESP32C3 Dev Module**.
3. Tools → **USB CDC On Boot: Enabled** (otherwise the Serial Monitor shows nothing),
   **Flash Mode: DIO**, Partition Scheme: **Default 4MB with spiffs**.
4. Library Manager: **Adafruit AHTX0** (accept its dependencies, Adafruit BusIO and
   Adafruit Unified Sensor) and **BH1750** by Christopher Laws.
5. Open `firmware/greenr_sensor_c3/greenr_sensor_c3.ino`, unplug the battery,
   connect USB, Upload.
6. If the upload does not start: hold **BOOT**, tap **RST**, let go of BOOT, upload
   again. Because the sensor spends almost all its time asleep, this is the normal
   way to reach it once the firmware is running.
7. Serial Monitor at 115200 baud, then tap RST: the first line should read
   `===== greenr sensor c3-1.0 =====`.

Compiled size with these settings: 1.21 MB of the 1.31 MB app partition. Turning
on `USE_BLE_SETUP` needs the "Huge APP" partition (1.49 MB).

### What the firmware does on each wake

1. Powers the soil probe, reads the battery (before Wi-Fi, so unloaded), the
   AHT10, and the BH1750 (once, then the sensor powers itself down), then the probe
   after 600 ms of warm-up; switches the probe off.
2. Below 3.40 V on battery (only with the divider fitted): no Wi-Fi, keep the
   reading, sleep 12 h.
3. Joins Wi-Fi, reusing the last channel and router to save a scan; transmit power
   8.5 dBm (`WIFI_TX_POWER`).
4. Uploads the new reading plus any not delivered before, in one HTTPS request,
   with the server's certificate checked against embedded root CAs.
5. On success sleeps for the server's interval (3 h default). On failure keeps the
   readings (up to 24) in RTC memory and retries after 5, 10, 20, 40, 80 minutes…
   never longer than the interval.

After RST or power-up there is a 2-second window to hold BOOT and forget the
Wi-Fi. With no saved Wi-Fi it opens the "greenr-setup" hotspot: indefinitely on
USB power, for 20 minutes on battery, then sleeps until RST.

---

## Legacy build: ESP32 dev kit (firmware v13)

`firmware/greenr_sensor/greenr_sensor.ino` targets a classic ESP32 dev kit with an
LDR. It is kept for units still running it. Its pins do not exist on an ESP32-C3.

| Component | Component pin | ESP32 dev kit | Purpose |
|---|---|---|---|
| Soil probe | VCC / AOUT | GPIO19 (switched) / GPIO39 | soil signal |
| LDR module | AO | GPIO34 | light, high = dark |
| AHT10 | SDA / SCL | GPIO21 / GPIO22 | air |
| BOOT button | | GPIO0 | forget Wi-Fi |

It uploads through `ingest_reading`, sends no battery, firmware version or signal,
and does not check the server's certificate.

---

## What each sensor can and cannot tell the app

### Capacitive soil probe

- **Measures:** how strongly the material around its blade loads an oscillator.
  That rises with water.
- **The app derives:** a relative moisture index, drying rate, time since
  watering, how much a pour raised the reading, whether the probe is seated.
- **Cannot measure:** water content in absolute terms (without a weighed
  calibration for that pot), salinity, nutrients, pH, or anything below the
  6.5 cm the blade reaches.
- **Limits:** unit-to-unit variation in its air and water readings, which is why
  each sensor needs its own (Calibrate → Soil sensor scale); drift with
  temperature and salts; the reading depends on how firmly soil is packed against
  the blade. Some v1.2 boards are sold with an NE555 timer instead of a TLC555,
  which does not run at 3.3 V: if the raw reading barely changes between air and
  water, that is the likely cause.
- **Verdict:** keep. It is the right sensor at this price. Calibrate each unit.

### BH1750

- **Measures:** illuminance in lux, with a response close to the eye's.
  Datasheet accuracy about ±20 %.
- **The app derives:** the light index (exactly, between 80 and 65 000 lux), daily
  light with a 1.3× uncertainty band instead of the LDR's 2×, light suitability.
- **Range:** about 54 600 lux at the default setting; the firmware switches to the
  shortest integration time above 40 000 lux, reaching about 121 500 lux. Above
  that it reads full scale and the database flags it.
- **Cannot measure:** photosynthetic photons (PPFD) directly. Lux to PPFD depends
  on the light source, which is most of the remaining uncertainty.
- **Mounting:** sensor window facing up and uncovered. Behind a lid or tinted
  case it reads low by whatever the cover absorbs.

### AHT10

- **Measures:** air temperature and relative humidity, about ±0.3 °C and ±2 % RH.
- **The app derives:** VPD, comfort against the species range, and the
  evaporative-demand correction to drying rate.
- **Cannot measure:** leaf or soil temperature.
- **Now read before Wi-Fi starts**, so radio self-heating does not bias it. Mount it
  away from the board and the battery.

### Battery divider (optional)

- **Measures:** the cell's voltage, through `analogReadMilliVolts()` (factory ADC
  calibration) × 2.
- **The app derives:** battery percent (SQL curve), low-battery warnings.
- **Limits:** resting voltage is only a rough guide to remaining charge, especially
  in the flat middle of a lithium cell's curve. Expect ±10 % on the percentage.

### ESP32-C3

Adequate: Wi-Fi, deep sleep in the microamp range, five ADC1 inputs, I²C. No change needed.

---

## What to add next

Prices are typical hobby-module prices from memory, **not checked on the day**.

| Sensor | Status | Notes |
|---|---|---|
| Battery divider | **done** | GPIO1 |
| Digital lux sensor (BH1750) | **done** | replaces the LDR |
| Read AHT10 before Wi-Fi | **done** | firmware |
| DS18B20 waterproof probe, soil temperature | valuable later, $2–4 | temperature compensation of the soil reading; 1 GPIO + 4.7 kΩ pull-up (GPIO0 is free) |
| SHT40 in place of AHT10 | valuable later, $2–6 | better humidity accuracy and less drift; same I²C bus |
| Load cell + HX711, as a calibration stand | valuable now, for the lab, $3–8 | actual water content by weight: the reference that validates the index, the substrate library and the dose model |
| VEML7700 instead of BH1750 | optional | reaches 120 klx without range switching; only worth it for full-sun outdoor plants |
| Soil EC probe | unnecessary for now | cheap ones corrode within months |
| PAR quantum sensor, pH probe | unnecessary | cost and maintenance far beyond the product |

How a new sensor fits the software: `readings` gains a nullable column, `ingest_v2`
gains an optional row field, and `normalizeReading` prefers the measured field
when it is present. That is exactly how lux and battery were added.

---

## Firmware issues

| Issue | Status |
|---|---|
| Device id and secret are compile-time constants | **open.** Each unit needs its own build (`npm run provision` makes the pair and the QR sticker); the pair in this repository is a real credential |
| TLS certificate checking disabled | **fixed in c3-1.0.** The server's chain (supabase.co ← WE1 ← GTS Root R4) is checked against embedded roots (GTS R1/R4, ISRG X1/X2), verified against the live server with a strict TLS client before shipping. If Supabase's certificate authority changes, uploads fail with a certificate error: add its root to `ROOT_CAS`, or set `VERIFY_TLS 0` to confirm that is the cause |
| No firmware version in the upload | **fixed** (`p_fw`) |
| No battery measurement | **fixed** |
| Temperature read after the radio was on | **fixed** |
| Readings lost when an upload fails | **fixed**: up to 24 kept in RTC memory (lost on RST or power loss) |
| `read_now` ignored | open; a sleeping sensor cannot hear it until its next wake |

---

## Needs physical verification

- The raw soil count in open air and in water on the C3, for several units (the
  app's factory pair was measured on the dev kit).
- That the C3 joins Wi-Fi at 8.5 dBm at your distance from the router.
- The BH1750 against a lux meter from 50 to 50 000 lux, in its final housing.
- Whether the AHT10 reads warm in the housing, and by how much.
- Deep-sleep current with the soil rail off, with and without the power LED.
- That the 5V pin and USB are separated on your board before charging and
  uploading at the same time.
- That the TLS check passes on the device (it passes from a computer).
