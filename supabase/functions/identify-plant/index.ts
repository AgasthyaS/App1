// Supabase Edge Function (Deno).  Deploy:  supabase functions deploy identify-plant
// Secret:  supabase secrets set GEMINI_API_KEY=…      (never in the repo, never in the app)
//
// POST { imageBase64, plantKey? } with the caller's Supabase session as the
// bearer token. Returns a validated identification. See docs/AI.md.
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { PROMPT_VERSION, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, USER_PROMPT } from '../_shared/identify.ts';
import { identify, type IdentifyDeps } from '../_shared/identifyHandler.ts';

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const PRIMARY = Deno.env.get('IDENTIFY_MODEL') ?? 'gemini-3.1-flash-lite';
// Set IDENTIFY_ESCALATION_MODEL to "none" to disable the second pass.
const ESCALATION_ENV = Deno.env.get('IDENTIFY_ESCALATION_MODEL') ?? 'gemini-3.5-flash-lite';
const ESCALATION = ESCALATION_ENV === 'none' ? null : ESCALATION_ENV;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only', code: 'method' });
  if (!GEMINI_KEY) {
    // Say exactly what is missing — to the operator's logs, not to the caller.
    console.error('GEMINI_API_KEY is not set. Run: supabase secrets set GEMINI_API_KEY=<key>');
    return json(503, { error: 'Photo identification is not set up yet.', code: 'not-configured' });
  }

  // Who is asking. The JWT is verified by Supabase Auth, not parsed here.
  const auth = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asUser.auth.getUser();
  const userId = who?.user?.id;
  if (!userId) return json(401, { error: 'Sign in to identify plants from a photo.', code: 'auth' });

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return json(400, { error: 'Body must be JSON.', code: 'bad-json' });
  }

  // Privileged writes (usage log, cache, identification record) use the service
  // role, which exists only inside this function's environment.
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  const deps: IdentifyDeps = {
    models: { primary: PRIMARY, escalation: ESCALATION },
    async callModel(model, image, detail) {
      const t0 = Date.now();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: image.mime, data: image.base64 } }, { text: USER_PROMPT }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            ...(detail === 'low' ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      const u = body.usageMetadata ?? {};
      return {
        text: (body.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join(''),
        inputTokens: u.promptTokenCount ?? 0,
        outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        ms: Date.now() - t0,
      };
    },
    async sha256Hex(bytes) {
      const d = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    },
    async cacheGet(uid, key) {
      const { data } = await admin.from('ai_cache').select('result, model')
        .eq('user_id', uid).eq('task', 'identify').eq('input_hash', key).maybeSingle();
      return data ? { result: data.result, model: data.model } : null;
    },
    async cachePut(uid, key, result, model) {
      await admin.from('ai_cache').upsert({ user_id: uid, task: 'identify', input_hash: key, result, model });
    },
    async recentCount(uid) {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [done, calls] = await Promise.all([
        admin.from('plant_identifications').select('id', { count: 'exact', head: true })
          .eq('user_id', uid).gte('created_at', since),
        // Model calls, including ones that failed: a request that never yields a
        // stored result must still count, or the limit could be walked around.
        admin.from('ai_usage').select('id', { count: 'exact', head: true })
          .eq('user_id', uid).eq('task', 'identify').eq('cache_hit', false).gte('created_at', since),
      ]);
      // An identification is at most two model calls.
      return Math.max(done.count ?? 0, Math.ceil((calls.count ?? 0) / 2));
    },
    async logUsage(r) {
      await admin.from('ai_usage').insert({
        user_id: r.userId, task: r.task, provider: r.provider, model: r.model,
        input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: r.costUsd,
        latency_ms: r.latencyMs, cache_hit: r.cacheHit, ok: r.ok, error: r.error,
      });
    },
    async saveIdentification(r) {
      const top = r.result.candidates[0];
      const { data } = await admin.from('plant_identifications').insert({
        user_id: r.userId, plant_key: r.plantKey, image_sha256: r.imageSha256,
        provider: 'google', model: r.model, prompt_version: PROMPT_VERSION, escalated: r.escalated,
        is_plant: r.result.is_plant, image_issue: r.result.image_issue,
        top_common: top?.common ?? null, top_latin: top?.latin ?? null,
        rank: top?.rank ?? null, confidence: top?.confidence ?? null,
        candidates: r.result.candidates,
      }).select('id').single();
      return data?.id ?? null;
    },
  };

  const out = await identify(deps, userId, input);
  return json(out.status, out.body);
});
