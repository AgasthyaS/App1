#!/usr/bin/env bash
# Builds a SIMULATION copy of the real firmware (../greenr_sensor_c3) for Wokwi.
#
# The sketch is the real one, byte for byte, except for these settings:
#   DEVICE_ID / DEVICE_KEY  the TEST device from .env.local (keeps your real sensor's history clean)
#   WIFI_SSID "Wokwi-GUEST" Wokwi's open virtual network, which reaches the real internet
#   POWER_SOURCE PWR_USB    stay awake (as on a computer), so one run shows several uploads
#   LEARN_SECONDS 60        a reading a minute instead of an hour, to fit a 5-minute run
#   FW_VERSION "c3-1.2-sim" so the uploads are recognisable in the database
# and it is built with the serial port on the UART pins, which Wokwi's monitor reads.
#
# Usage:  ARDUINO_CLI=/path/to/arduino-cli [ARDUINO_CONFIG=/path/cfg.yaml] ./build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CLI="${ARDUINO_CLI:-arduino-cli}"
CFG=()
[ -n "${ARDUINO_CONFIG:-}" ] && CFG=(--config-file "$ARDUINO_CONFIG")

val() { grep -E "^$1=" "$ROOT/.env.local" 2>/dev/null | tail -1 | cut -d= -f2-; }
ID="$(val TEST_DEVICE_ID)"; KEY="$(val TEST_DEVICE_KEY)"
if [ -z "$ID" ] || [ -z "$KEY" ]; then
  echo "TEST_DEVICE_ID / TEST_DEVICE_KEY missing from .env.local" >&2; exit 1
fi

SK="$HERE/build/sketch/greenr_sensor_c3"
rm -rf "$HERE/build"; mkdir -p "$SK"
sed -E \
  -e "s|^#define DEVICE_ID   \".*\"|#define DEVICE_ID   \"$ID\"|" \
  -e "s|^#define DEVICE_KEY  \".*\"|#define DEVICE_KEY  \"$KEY\"|" \
  -e 's|^#define WIFI_SSID  ""|#define WIFI_SSID  "Wokwi-GUEST"|' \
  -e 's|^#define POWER_SOURCE      PWR_AUTO|#define POWER_SOURCE      PWR_USB|' \
  -e 's|^#define LEARN_SECONDS     3600|#define LEARN_SECONDS     60|' \
  -e 's|^#define FW_VERSION        "c3-1\.2"|#define FW_VERSION        "c3-1.2-sim"|' \
  "$ROOT/firmware/greenr_sensor_c3/greenr_sensor_c3.ino" > "$SK/greenr_sensor_c3.ino"

# Every override must have landed, or the run would prove nothing.
for want in "$ID" "$KEY" '"Wokwi-GUEST"' 'PWR_USB' 'LEARN_SECONDS     60' '"c3-1.2-sim"'; do
  grep -q -- "$want" "$SK/greenr_sensor_c3.ino" || { echo "override not applied: $want" >&2; exit 1; }
done

"$CLI" "${CFG[@]}" compile --fqbn "esp32:esp32:esp32c3:CDCOnBoot=default,FlashMode=dio" \
  --output-dir "$HERE/build" "$SK"
echo "Built $HERE/build/greenr_sensor_c3.ino.merged.bin"
