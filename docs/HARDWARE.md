# Greenr hardware

What the sensor is, how it is wired according to the firmware in this repository,
what each part can and cannot measure, and what to add next.

**Nothing here was physically inspected or tested.** It is drawn from
`firmware/greenr_sensor/greenr_sensor.ino` (version banner "v13"), the app's
conversion code, and the parts' published characteristics. Anything that needs a
meter or the board in hand is listed under "Needs physical verification".

---

## The firmware in this repository is not for the ESP32-C3

The stated current hardware is an **ESP32-C3 Super Mini**. The firmware source in
the repository says "THIS BUILD = ESP32 dev kit" and uses these pins:

| Firmware constant | GPIO | On an ESP32-C3 Super Mini |
|---|---|---|
| `LDR_PIN` | 34 | does not exist (the C3 has GPIO 0–10, 20, 21) |
| `SOIL_PIN` | 39 | does not exist |
| `SENSOR_PWR` | 19 | is the USB D+ line |
| `AHT_SDA` | 21 | is UART TX |
| `AHT_SCL` | 22 | does not exist |
| `BOOT_BTN` | 0 | the C3's BOOT button is GPIO 9 |

So either the C3 build lives somewhere else and was never committed, or the
device in use is still the dev kit. **The pin assignments on the real C3 board
are unknown from this repository.** No firmware was changed in this overhaul.

This matters beyond wiring: the app's factory soil endpoints (3020 in air, 1400
in water) and light endpoints (3200 dark, 200 bright) were measured through the
original ESP32's converter. The C3's converter has a different input range, so
those constants are probably wrong for it. Per-sensor endpoint capture
(Calibrate → Soil sensor scale) exists for exactly this.

---

## Wiring as the committed firmware defines it (ESP32 dev kit)

| Component | Component pin | ESP32 dev kit | Voltage | Purpose |
|---|---|---|---|---|
| Capacitive soil probe | VCC | GPIO 19 | 3.3 V, switched | powered only while reading (600 ms settle) |
| | GND | GND | | |
| | AOUT | GPIO 39 ("VN"), ADC1 | 0 to about 3 V analog | soil signal |
| LDR module | VCC | 3V3 (not stated in firmware) | 3.3 V | |
| | GND | GND | | |
| | AO | GPIO 34, ADC1 | 0–3.3 V analog | light signal, high = dark |
| AHT10 | VCC | 3V3 | 3.3 V | |
| | GND | GND | | |
| | SDA | GPIO 21 | 3.3 V I²C | address 0x38 |
| | SCL | GPIO 22 | 3.3 V I²C | |
| BOOT button | | GPIO 0, internal pull-up | | hold 3 s after power-on to clear Wi-Fi |
| DHT22 (old build, `USE_DHT22 1`) | DATA | GPIO 18 + 10 kΩ to 3V3 | 3.3 V | not the current configuration |

Other facts from the firmware:

- `analogReadResolution(12)`: counts 0–4095. Attenuation is left at the core's default.
- Each analog value is the median of 7 samples 20 ms apart.
- Soil and light are sent as raw counts. Temperature (°C) and humidity (%) are sent as read.
- Battery is not measured: the firmware sends `-1`.
- Reports every 3 hours by default; the server can change the interval
  (`devices.wake_seconds`, accepted range 60 s to 24 h). A failed upload retries in 5 minutes.
- `USE_DEEP_SLEEP 0`: this build stays awake on wall power. Deep sleep is a compile-time option.
- `USE_BLE_SETUP 0`: setup is through the "greenr-setup" hotspot only.
- I²C pull-ups: none in the firmware. AHT10 breakout boards normally carry their own.

---

## Proposed wiring for the ESP32-C3 Super Mini

**A proposal, not a description of any existing board.** It follows the C3's
constraints; confirm against the board in hand before using it.

| Component | Component pin | ESP32-C3 GPIO | Why this pin |
|---|---|---|---|
| Soil probe | AOUT | GPIO 3 (ADC1_CH3) | ADC1 works with Wi-Fi on; ADC2 (GPIO 5) does not |
| | VCC | GPIO 10 | a free output, to keep the switched-power design |
| LDR module | AO | GPIO 4 (ADC1_CH4) | ADC1 |
| | VCC | GPIO 10, shared with the probe | cuts the module's idle draw in deep sleep |
| AHT10 | SDA | GPIO 6 | avoids the strapping pins |
| | SCL | GPIO 7 | |
| | VCC | 3V3 | |
| Battery divider (new) | midpoint | GPIO 1 (ADC1_CH1) | see upgrades |
| BOOT button | | GPIO 9 (on board) | already there |

Pins to avoid on the C3: GPIO 2, 8, 9 (strapping; 8 is also the on-board LED),
GPIO 18 and 19 (USB), GPIO 20 and 21 (UART), GPIO 5 for analog (ADC2).

```
                 ESP32-C3 Super Mini
                ┌──────────────────┐
   Soil AOUT ───┤ GPIO3      3V3   ├─── AHT10 VCC
    LDR AO  ────┤ GPIO4      GND   ├─── all grounds
  AHT10 SDA ────┤ GPIO6      GPIO10├─── Soil VCC + LDR VCC (switched)
  AHT10 SCL ────┤ GPIO7      GPIO1 ├─── battery divider midpoint (optional)
                │            5V    ├─── USB / battery boost
                └──────────────────┘
```

Voltage notes for the C3:

- The converter's usable range at the highest attenuation is about 0 to 2.5 V.
  The LDR module can output up to 3.3 V in darkness, which will read as full
  scale. That only flattens the dark end, which carries no useful information.
- A GPIO should not be asked for more than a few tens of milliamps. The probe
  draws about 5 mA. An LDR module with a comparator and LED can draw more; if the
  switched rail sags, power the modules through a small P-channel MOSFET instead.

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
- **Limits:** unit-to-unit variation in endpoints; drift with temperature and
  salts; the reading depends on how firmly soil is packed against the blade;
  cheap copies of this board are reported to ship with a missing voltage
  regulator or a timer chip that does not run at 3.3 V.
- **Verdict:** keep. It is the right sensor at this price. Calibrate each unit.

### LDR module

- **Measures:** resistance of a photoresistor on a voltage divider.
- **The app derives:** a relative light index and a daily-light estimate with a
  stated factor-of-two uncertainty.
- **Cannot measure:** lux, PPFD or DLI in any calibrated sense. Its spectral
  response matches neither the eye nor photosynthesis, and part-to-part
  variation is ±50 %.
- **The serious limit:** with typical parts the divider stops resolving at a few
  thousand lux. Direct sun is 50 000 or more. It probably cannot tell bright
  shade from full sun. See FORMULAS.md §4.6.
- **Verdict:** replace. This is the weakest part of the system and the cheapest to fix.

### AHT10

- **Measures:** air temperature and relative humidity. Datasheet accuracy is
  about ±0.3 °C and ±2 % RH.
- **The app derives:** VPD, comfort against the species range, and the
  evaporative-demand correction to drying rate.
- **Cannot measure:** leaf or soil temperature.
- **Limits:** mounted in the housing next to a Wi-Fi radio it will read warm
  after each transmission; RH sensors of this class drift over years.
- **Verdict:** keep. Read it before turning Wi-Fi on, and mount it away from the board.

### ESP32-C3

Adequate. Wi-Fi and BLE, deep sleep in the microamp range, five ADC1 inputs,
I²C. No change needed.

---

## What to add

Prices are typical hobby-module prices from memory, **not checked on the day**.
Confirm before ordering.

| Sensor | Measures | What Greenr gains | Rough cost | Power | C3 fit | Class |
|---|---|---|---|---|---|---|
| **Battery voltage divider** (2 resistors) | supply voltage | battery level and "replace soon"; the app already has the fields | cents | negligible with high-value resistors | 1 ADC pin | **necessary now** |
| **Digital lux sensor**: BH1750, or VEML7700 for wider range | illuminance in lux, calibrated, to 65 k (BH1750) or 120 k lux (VEML7700) | a real lux reading replaces the LDR guess; daily-light uncertainty falls from a factor of two to the spectral conversion alone (about ±15 %) | $1–5 | under 0.2 mA active, microamps asleep | I²C, shares the AHT10 bus | **necessary now** |
| **DS18B20 waterproof probe** | soil temperature | temperature compensation of the soil reading; root-zone cold warnings | $2–4 | about 1 mA while converting | 1 GPIO, 4.7 kΩ pull-up | valuable later |
| **SHT40 / SHT41** in place of AHT10 | temperature, humidity (about ±0.2 °C, ±1.8 % RH) | modestly better VPD; less drift | $2–6 | microamps | I²C | valuable later |
| **Load cell + HX711**, as a calibration stand, not in every unit | pot mass | actual water content by weight: the reference that validates the index, the substrate library and the dose model | $3–8 | about 1.5 mA active | 2 GPIO | **valuable now, for the lab** |
| Spectral sensor (AS7341) | 11 spectral bands | an approximation of PAR under any lamp | $10–16 | under 1 mA | I²C | later, only if grow-light users matter |
| Soil EC probe | electrical conductivity | salt build-up, fertiliser timing | cheap resistive probes corrode within months; reliable ones cost more than the whole unit | varies | varies | unnecessary for now |
| True PAR quantum sensor | PPFD | exact DLI | $300 and up | | analog | unnecessary |
| Soil pH probe | pH | | glass electrodes need wet storage and regular calibration | | | unnecessary |

### Stage 1: current hardware

Everything in this overhaul. The remaining gains are free: capture each sensor's
own soil endpoints, set pot dimensions and substrate, log waterings with amounts.

### Stage 2: highest value for least money (about $2–6 per unit)

1. **Battery divider.** Cents. Removes "why did it stop reporting".
2. **BH1750 or VEML7700 instead of the LDR.** Fixes the weakest measurement in
   the product. Software path: the firmware sends lux in a new field; the app
   uses it in place of the index when present (`lightModel.luxToIndex` already
   exists for the conversion, and the light pipeline already averages in lux).
3. **Read the AHT10 before Wi-Fi starts**, firmware only.

### Stage 3: fuller configuration (adds about $5–10)

4. DS18B20 soil temperature.
5. SHT40 in place of the AHT10.
6. One load-cell calibration stand per lab, used to produce weighed curves and
   to validate the substrate library. Not a per-unit part.

How new sensors fit the software: `readings` gains nullable columns
(`lux`, `soil_temp_c`, `battery_mv`), the ingest function gains optional
parameters under a new name so deployed firmware is unaffected, and
`normalizeReading` prefers a calibrated field over a derived one when both
exist. Nothing else needs to change.

---

## Firmware issues noticed

Not changed here; listed for whoever maintains the firmware.

| Issue | Where | Why it matters |
|---|---|---|
| Device id and secret are compile-time constants in the source | `DEVICE_ID`, `DEVICE_KEY` | every unit needs its own build; the pair in the repository is a real credential |
| TLS certificate checking disabled | `client.setInsecure()` | the upload can be intercepted on a hostile network |
| No firmware version in the upload | `uploadRaw` | readings cannot be tied to a firmware build |
| No battery measurement | `p_battery: -1` | the app's battery features have no data |
| Temperature is read after the radio has been on | `readAndSend` order | self-heating bias |
| Readings are not buffered when an upload fails | retry re-reads | a Wi-Fi outage loses those hours |

---

## Needs physical verification

- Which board is actually deployed, and its real pin assignments.
- The raw soil count in open air and in water on that board, for several units.
- The resistor value and LDR type on the light module, and its reading against
  a lux meter from 50 to 50 000 lux.
- Whether the AHT10 reads warm in the housing, and by how much.
- Current draw in deep sleep with the sensor rail switched off.
- That the capacitive probe's electronics are sealed against watering.
