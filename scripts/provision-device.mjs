#!/usr/bin/env node
// Provision one greenr sensor:
//   1. generates a unique device id + secret
//   2. registers it (unclaimed) in Supabase
//   3. saves a QR sticker PNG (the user scans it in the app to pair)
//   4. prints the two #define lines to paste into the firmware before flashing
//
// Requires the Supabase SERVICE ROLE key (Project Settings → API → service_role).
// Keep it PRIVATE — put it in .env as SUPABASE_SERVICE_ROLE. It is never shipped
// in the app or firmware; it only runs here on your machine.
//
// Usage:  node scripts/provision-device.mjs "Kitchen basil sensor"

import 'dotenv/config';
import crypto from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://knyymwvrqitptfzckyvf.supabase.co';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE;

if (!SERVICE) {
  console.error(
    '\n✗ Missing SUPABASE_SERVICE_ROLE in .env\n' +
    '  Get it: Supabase → Project Settings → API → "service_role" secret key.\n' +
    '  Add a line to .env:  SUPABASE_SERVICE_ROLE=eyJ...\n' +
    '  (Keep it private — never commit it or put it in the app/firmware.)\n',
  );
  process.exit(1);
}

const label = process.argv[2] || 'greenr sensor';
const id = crypto.randomUUID();
const key = crypto.randomBytes(16).toString('hex');

const res = await fetch(`${URL}/rest/v1/devices`, {
  method: 'POST',
  headers: {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({ id, secret: key, label }),
});
if (!res.ok) {
  console.error('✗ Could not register device:', res.status, await res.text());
  process.exit(1);
}

const payload = `greenr://pair?d=${id}&k=${key}`;
const outDir = join(root, 'provisioned');
mkdirSync(outDir, { recursive: true });
const png = join(outDir, `${id}.png`);
await QRCode.toFile(png, payload, { width: 512, margin: 2 });

console.log(`\n✅ Provisioned "${label}"\n`);
console.log('  Device ID :', id);
console.log('  Device key:', key);
console.log('  QR sticker:', png, '(print this and stick it on the unit)');
console.log('\n  Paste into firmware/greenr_sensor/greenr_sensor.ino before flashing THIS unit:');
console.log(`    #define DEVICE_ID   "${id}"`);
console.log(`    #define DEVICE_KEY  "${key}"\n`);
