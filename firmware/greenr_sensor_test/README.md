# greenr sensor — hardware test (`t1.0`)

[`greenr_sensor_test.ino`](greenr_sensor_test.ino) checks the wiring and every part
before you upload the real sensor code. It uploads nothing, joins no Wi-Fi network,
and leaves the saved settings alone. **No battery is needed.** It runs from the USB-C
cable and skips the battery check.

The full wiring guide is at the top of the `.ino` file. It has a pin diagram, each
part's pins, and a numbered wire-by-wire list.

## Run it

1. Wire it as shown at the top of the `.ino` file, then plug the USB-C into the computer.
2. In the Arduino IDE, open `greenr_sensor_test.ino` with File → Open. The folder
   name must stay `greenr_sensor_test`. Use the same Tools settings as the real code:
   ESP32C3 Dev Module, **USB CDC On Boot: Enabled**, Flash Mode: DIO.
3. Upload, then open the Serial Monitor at 115200 baud straight away. If you missed
   the start, press **RST**.
4. Keep the probe out of the soil, clean and dry. After the automatic checks, it asks
   you to do four things. Each one waits 20 s, and you can just wait to skip it:
   - cover the light sensor
   - breathe on the AHT10
   - dip the probe in water
   - press BOOT

## What it checks

| Check | Passes when |
|---|---|
| Board | ESP32-C3 with 4 MB flash |
| USB power | the board didn't brown out, i.e. the supply didn't dip |
| Battery | skipped: `HAS_BATTERY 0` |
| I2C wiring | SDA (GPIO6) and SCL (GPIO7) are pulled up by the sensor boards and something answers. If SDA and SCL are swapped, it says so. |
| AHT10 | answers at 0x38 and gives 5 sensible readings |
| BH1750 | answers at 0x23 and gives 3 readings |
| Soil probe | reads 200 or more with GPIO10 on, drops back with GPIO10 off (so GPIO10 really switches it), and holds steady |
| Wi-Fi radio | sees at least one network (your home network should be in the list) |
| Light / humidity / probe reacts | the reading changes when you act on the sensor |
| BOOT button | a press is seen |

## What a good run ends with

The numbers below are an example. Yours will differ.

```
==================== RESULT ====================
  PASS  Board            ESP32-C3 v0.4 · 4 MB flash
  PASS  USB power        from a computer · no battery needed
  SKIP  Battery          none fitted (HAS_BATTERY 0) — USB power is all it needs
  PASS  I2C wiring       SDA and SCL OK · 0x23 BH1750  0x38 AHT10
  PASS  AHT10            22.8 °C · 44.1 %RH
  PASS  BH1750           318 lux
  PASS  Soil probe       2984 in air (2.41 V) · power switched by GPIO10 · steady
  PASS  Wi-Fi radio      6 networks · strongest -52 dBm
  PASS  Light reacts     318 → 6 lux
  PASS  Humidity reacts  44.1 → 61.7 %RH
  PASS  Probe reacts     2984 → 1415 (lower = wetter)
  PASS  BOOT button      works (the real sensor uses it to forget its Wi-Fi)
------------------------------------------------
  ALL HARDWARE OK.
  Next: upload firmware/greenr_sensor_c3/greenr_sensor_c3.ino — the real sensor code.
```

Every FAIL or WARN line is followed by a `Fix:` line that says what to change.
After the result, the test keeps printing a live reading every 1.5 s. Press BOOT to
show the result again, or RST to run the whole test again.

When everything passes, upload the real code:
[`../greenr_sensor_c3/greenr_sensor_c3.ino`](../greenr_sensor_c3/greenr_sensor_c3.ino).
