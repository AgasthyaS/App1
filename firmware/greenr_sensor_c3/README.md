# greenr sensor — ESP32-C3 firmware (`c3-1.2`)

The code for the device is [`greenr_sensor_c3.ino`](greenr_sensor_c3.ino), in this folder.
Open that file in the Arduino IDE (File → Open). The folder name must stay
`greenr_sensor_c3`, the same as the file, or the IDE refuses to open it.

Wiring and the reasons behind each pin: [docs/HARDWARE.md](../../docs/HARDWARE.md).

## Before you upload

0. Test the wiring first with the hardware test,
   [`../greenr_sensor_test/greenr_sensor_test.ino`](../greenr_sensor_test/greenr_sensor_test.ino).
   It checks every sensor without a battery and says exactly what to fix.
1. Supabase has SQL files 14, 15 and 16 run (file 14 creates the upload function;
   16 corrects how it stores readings). Without 14, every upload is refused.
2. Lines marked `CHANGE THESE 2 LINES FOR EACH DEVICE` hold this board's ID and key.
   Nothing else changes between boards. Wi-Fi is not in the code; it is set from
   the app.

## Power: USB is fine

No battery is needed. A USB-C cable to a wall USB adapter (5 V, 1 A) runs it
indefinitely.

| Plugged into | What it does between readings | Why |
|---|---|---|
| a wall adapter or power bank | deep sleep | the board stays cool, so the AHT10 reads the room, not the board |
| a computer (seen at power-up or RST) | stays awake | Serial Monitor keeps running; uploads need no BOOT + RST |
| a battery, with the divider | deep sleep; stops using Wi-Fi below 3.40 V | protects the cell |

`POWER_SOURCE` overrides the automatic choice: `PWR_USB` (always awake),
`PWR_BATTERY` (a battery without the divider: the setup hotspot then closes
after 20 minutes instead of waiting forever).

A laptop that goes to sleep cuts the power — use a wall adapter for real use.

## Arduino IDE

| Setting | Value |
|---|---|
| Boards Manager | **esp32** by Espressif, 3.x or 4.x (last compiled on 4.0.0) |
| Board | ESP32C3 Dev Module |
| USB CDC On Boot | **Enabled** (otherwise the Serial Monitor shows nothing) |
| Flash Mode | DIO |
| Partition Scheme | Default 4MB with spiffs (Huge APP if a future core says "too big") |
| Libraries | Adafruit AHTX0 (accept its dependencies), BH1750 by Christopher Laws |

Upload with the battery disconnected. If the upload does not start: hold BOOT,
tap RST, let go of BOOT, upload again (only needed when it is deep-sleeping).

## What a working connection looks like

Serial Monitor at 115200 baud, then tap RST. A first-time setup on a computer:

```
===== greenr sensor c3-1.2 =====
AHT10 found · BH1750 found
Hold BOOT now for 3 s to forget the saved Wi-Fi.
read: soil raw=3612  lux=212.4  temp=22.1 °C  hum=48.0 %  battery=-1 mV
Power: USB, computer attached — staying awake between readings.
No saved Wi-Fi.
SETUP HOTSPOT — join Wi-Fi "greenr-setup" (no password). …
   (in the app: Devices → Pair a sensor → follow the Wi-Fi steps)
Got Wi-Fi details for "Home".
Wi-Fi: joining "Home" ...
Wi-Fi connected — IP 192.168.1.42, signal -58 dBm
Wi-Fi saved ("Home") — it will reconnect on its own.
===== SET UP — uploading to your app now. =====
Uploaded 1 reading (HTTP 200): {"read_now" : false, "wake_seconds" : 10800, "inserted" : 1, "skipped" : 0}
Setup burst: next reading in 90 s — keep the probe in the air until the app says it has it.
```

Then two more readings 90 s apart (the automatic "in air" reference), then
`Learning week: reading 1 of 168, every 3600 s.` — hourly for a week, then every
3 hours. `battery=-1 mV` just means no battery is measured (USB power).

If something is wrong, the Serial Monitor says what:

| Message | Meaning |
|---|---|
| `AHT10 NOT FOUND` / `BH1750 NOT FOUND` | SDA → GPIO6 and SCL → GPIO7 swapped or loose |
| `soil raw is very low` | probe unplugged, or its VCC is not on GPIO10 |
| `Wi-Fi FAILED` | 5 GHz-only network, wrong password, or too far from the router |
| `Upload FAILED (HTTP 400) … ingest_v2` | SQL file 14 has not been run |
| `bad device or secret` | the two device lines do not match a provisioned sensor |
| a certificate error | see `ROOT_CAS` in the sketch |

## Checked before release (2026-11-18)

- Compiles: default; USB CDC off; `PWR_USB`; `PWR_BATTERY`; never-sleep; with
  battery divider. (Bluetooth setup needs core 3.x; the sketch says so if built on 4.)
- The live server's certificate verifies against the four roots in the sketch.
- The firmware's exact request reaches the live upload function; this board's ID
  and key are accepted.
- The upload body the firmware builds is parsed and stored correctly by the
  database (tests/db/readings.test.ts), including no-battery, missing-sensor and
  disconnected-probe readings.

Not yet run on real hardware.
