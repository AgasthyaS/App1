# Proving the firmware sends — before the hardware arrives

[Wokwi](https://wokwi.com) emulates an ESP32-C3 and gives it Wi-Fi with real internet
access. `build.sh` compiles a copy of the real sketch (`../greenr_sensor_c3`) that
differs in six settings only — test device, Wokwi's open Wi-Fi, stay awake, a
reading a minute, version `c3-1.2-sim` — and `run.sh` runs it. The run passes when
the emulated board has booted, joined Wi-Fi, verified Supabase's certificate,
POSTed its readings and had them stored, **twice**.

A potentiometer stands in for the soil probe (it is an analog voltage on GPIO3,
like the probe). Wokwi has no AHT10 or BH1750, so the firmware reports them "NOT
FOUND" and uploads those values as null — which also proves that a missing sensor
does not stop an upload.

## One-time setup

1. **Wokwi CLI:** `curl -L https://wokwi.com/ci/install.sh | sh` (or download from
   github.com/wokwi/wokwi-cli/releases and put it on your PATH).
2. **Token:** a free account at wokwi.com, then a CI token at
   https://wokwi.com/dashboard/ci. Add `WOKWI_CLI_TOKEN=…` to `.env.local` in the
   project root (git ignores it). The free plan allows 50 simulation minutes a
   month; one run uses about 3.
3. **Test device:** `.env.local` holds `TEST_DEVICE_ID` / `TEST_DEVICE_KEY`. Create
   that device in the Supabase SQL editor (values from `.env.local`):

   ```sql
   insert into public.devices (id, secret, label)
   values ('<TEST_DEVICE_ID>', '<TEST_DEVICE_KEY>', 'Wokwi simulator test — delete after the run')
   on conflict (id) do nothing;
   ```

## Run

```
cd firmware/simulation
ARDUINO_CLI=arduino-cli ./build.sh
./run.sh
```

The serial log is saved to `build/serial.log`. Afterwards, the health check
(`supabase/checks/readings_health.sql`) shows the test device and its readings.

## Clean up

```sql
delete from public.devices where id = '<TEST_DEVICE_ID>';   -- its readings go with it
```

## What this does not prove

The wiring, the two I²C sensors on a real bus, the real probe's numbers, and the
setup hotspot with a phone — those need the board itself
([firmware/greenr_sensor_c3/README.md](../greenr_sensor_c3/README.md) lists what a
working first boot prints).
