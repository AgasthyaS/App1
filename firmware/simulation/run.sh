#!/usr/bin/env bash
# Runs the simulation build on Wokwi's virtual ESP32-C3 and passes only when the
# firmware has uploaded to the live database TWICE (a minute apart): boot →
# Wi-Fi → TLS → POST → stored, then the whole cycle again.
#
# Needs: wokwi-cli on PATH, WOKWI_CLI_TOKEN (in the environment or .env.local),
# the test device created in Supabase (see README.md), and ./build.sh run first.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
if [ -z "${WOKWI_CLI_TOKEN:-}" ]; then
  WOKWI_CLI_TOKEN="$(grep -E '^WOKWI_CLI_TOKEN=' "$ROOT/.env.local" 2>/dev/null | tail -1 | cut -d= -f2-)"
  export WOKWI_CLI_TOKEN
fi
[ -n "$WOKWI_CLI_TOKEN" ] || { echo "WOKWI_CLI_TOKEN missing (https://wokwi.com/dashboard/ci)" >&2; exit 1; }
[ -f "$HERE/build/greenr_sensor_c3.ino.merged.bin" ] || { echo "run ./build.sh first" >&2; exit 1; }

wokwi-cli lint "$HERE" || true
wokwi-cli "$HERE" \
  --timeout 240000 \
  --expect-text "Learning week: reading 2 of" \
  --fail-text "Upload FAILED" \
  --serial-log-file "$HERE/build/serial.log"
echo "PASS — full serial output: $HERE/build/serial.log"
