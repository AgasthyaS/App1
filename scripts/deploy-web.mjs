#!/usr/bin/env node
// Rebuilds the web app and deploys it to Vercel.
//
// This wraps `expo export` with two fixes that are required every time, because
// `expo export` regenerates dist/ from scratch and wipes them:
//   1. Vercel refuses to serve any path containing "node_modules", but Expo puts
//      bundled fonts under assets/node_modules/... . We rename that folder to
//      assets/deps/ and rewrite the references in the JS bundle, or the app boots
//      to a permanent blank screen (it waits on fonts that 404).
//   2. Restores vercel.json (clean URLs + dynamic-route rewrites).
//   3. Pins the deploy to the correct Vercel project ("greenr").
//
// Usage:
//   VERCEL_TOKEN=xxxxx node scripts/deploy-web.mjs
//   (or run `npx vercel login` once, then omit the token)

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SCOPE = 'agasthyas-projects-32cbb2f5';
const PROJECT_ID = 'prj_lGbgr1czHUDtbHVtV4pwTwdOQ1ny';
const ORG_ID = 'team_tyaSzhBpdrGPmGx2nvs4WhjH';
const token = process.env.VERCEL_TOKEN;
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

console.log('\n▶ 1/4  Exporting static web build…');
run('npx expo export --platform web');

console.log('▶ 2/4  Fixing font paths (assets/node_modules → assets/deps)…');
renameSync(join(dist, 'assets', 'node_modules'), join(dist, 'assets', 'deps'));
for (const f of readdirSync(join(dist, '_expo', 'static', 'js', 'web'))) {
  if (!f.endsWith('.js')) continue;
  const p = join(dist, '_expo', 'static', 'js', 'web', f);
  const patched = readFileSync(p, 'utf8').split('assets/node_modules').join('assets/deps');
  writeFileSync(p, patched);
}

console.log('▶ 3/4  Restoring routing config + project link…');
copyFileSync(join(root, 'web-deploy.vercel.json'), join(dist, 'vercel.json'));
mkdirSync(join(dist, '.vercel'), { recursive: true });
writeFileSync(
  join(dist, '.vercel', 'project.json'),
  JSON.stringify({ projectId: PROJECT_ID, orgId: ORG_ID, projectName: 'greenr' })
);

console.log('▶ 4/4  Deploying to Vercel production…');
run(`npx vercel deploy dist --prod --yes --scope ${SCOPE} ${token ? `--token=${token}` : ''}`);

console.log('\n✅ Done. Live at https://greenr-app.vercel.app');
