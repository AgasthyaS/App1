/**
 * Compare vision models and image sizes on plant identification — tokens, cost,
 * latency, and how often the answer is right — against the live Gemini API.
 *
 *   GEMINI_API_KEY=… npx vite-node scripts/eval-identify.ts <dir-with-manifest.json> [out.json]
 *
 * manifest.json: [{ "file": "img/00.jpg", "label": "Monstera deliciosa" }, …]
 * A label of NOT_A_PLANT marks a negative. Resizing uses macOS `sips`.
 *
 * This is a smoke comparison on a handful of photos. It ranks options; it does
 * not measure accuracy in any sense worth quoting.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, USER_PROMPT, estimateCostUsd, validateIdentification,
} from '../supabase/functions/_shared/identify';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error('Set GEMINI_API_KEY');
const dir = path.resolve(process.argv[2] ?? '.');
const outFile = process.argv[3] ?? path.join(dir, 'results.json');
const MODELS = (process.env.MODELS ?? 'gemini-2.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-3.8-flash').split(',');
const SIZES = (process.env.SIZES ?? '384,768').split(',').map(Number);
const manifest: { file: string; label: string }[] = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

function resized(file: string, edge: number): Buffer {
  const out = path.join(dir, 'resized', `${edge}-${path.basename(file)}`);
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('sips', ['-Z', String(edge), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', path.join(dir, file), '--out', out], { stdio: 'ignore' });
  return readFileSync(out);
}

async function call(model: string, jpeg: Buffer) {
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }, { text: USER_PROMPT }] }],
      generationConfig: {
        temperature: 0, maxOutputTokens: 600, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA,
        ...(process.env.MEDIA_RES ? { mediaResolution: process.env.MEDIA_RES } : {}),
      },
    }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (e) {
    return { ms: Date.now() - t0, error: `timeout/network: ${(e as Error).message}` };
  }
  const ms = Date.now() - t0;
  const body: any = await res.json();
  if (!res.ok) return { ms, error: body?.error?.message ?? String(res.status) };
  const u = body.usageMetadata ?? {};
  const text = body.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  return {
    ms,
    inTok: u.promptTokenCount ?? 0,
    outTok: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    thoughtTok: u.thoughtsTokenCount ?? 0,
    id: validateIdentification(text),
    finish: body.candidates?.[0]?.finishReason,
  };
}

const genus = (s: string) => s.trim().split(/\s+/)[0].toLowerCase();
/** Names that changed genus; either is a correct answer. */
const SYNONYM: Record<string, string[]> = {
  dracaena: ['sansevieria'], sansevieria: ['dracaena'], goeppertia: ['calathea'], calathea: ['goeppertia'],
};

const rows: any[] = [];
const jobs: (() => Promise<void>)[] = [];
for (const m of manifest) for (const size of SIZES) {
  const jpeg = resized(m.file, size);
  for (const model of MODELS) jobs.push(async () => {
    let r: any = await call(model, jpeg);
    if (r.error && /overload|unavailable|rate|quota|429|503|timeout/i.test(r.error)) {
      await new Promise((ok) => setTimeout(ok, 4000));
      r = await call(model, jpeg);
    }
    const top = r.id?.candidates?.[0];
    const negative = m.label === 'NOT_A_PLANT';
    const want = genus(m.label);
    const hit = (c: any) => !!c && (genus(c.latin) === want || (SYNONYM[want] ?? []).includes(genus(c.latin)));
    rows.push({
      file: m.file, label: m.label, size, model, bytes: jpeg.length,
      ms: r.ms, inTok: r.inTok, outTok: r.outTok, thoughtTok: r.thoughtTok, error: r.error ?? null, valid: !!r.id,
      cost: r.error ? 0 : estimateCostUsd(model, r.inTok, r.outTok),
      top: top?.latin ?? null, conf: top?.confidence ?? null, rank: top?.rank ?? null, issue: r.id?.image_issue ?? null,
      correct: negative ? r.id?.is_plant === false : hit(top),
      inTop3: negative ? r.id?.is_plant === false : (r.id?.candidates ?? []).some(hit),
      speciesExact: !negative && !!top && top.latin.toLowerCase() === m.label.toLowerCase(),
    });
  });
}
// A small pool: enough to finish quickly, not enough to trip a rate limit.
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) await jobs[next++](); }));

writeFileSync(outFile, JSON.stringify(rows, null, 1));
const fmt = (x: number, d = 0) => x.toFixed(d);
console.log('model'.padEnd(24), 'px ', ' n', 'ok', 'top1', 'top3', 'hi&wrong', 'inTok', 'outTok', 'think', '  ms', ' $/1k ids');
for (const model of MODELS) for (const size of SIZES) {
  const r = rows.filter((x) => x.model === model && x.size === size && !x.error);
  if (!r.length) { console.log(model.padEnd(24), size, 'all failed:', rows.find((x) => x.model === model && x.error)?.error); continue; }
  const avg = (k: string) => r.reduce((s, x) => s + x[k], 0) / r.length;
  console.log(
    model.padEnd(24), String(size).padStart(3), String(r.length).padStart(2),
    String(r.filter((x) => x.valid).length).padStart(2),
    fmt((100 * r.filter((x) => x.correct).length) / r.length).padStart(3) + '%',
    fmt((100 * r.filter((x) => x.inTop3).length) / r.length).padStart(3) + '%',
    String(r.filter((x) => !x.correct && x.conf === 'high').length).padStart(8),
    fmt(avg('inTok')).padStart(5), fmt(avg('outTok')).padStart(6), fmt(avg('thoughtTok')).padStart(5),
    fmt(avg('ms')).padStart(5), fmt(avg('cost') * 1000, 3).padStart(8),
  );
}
