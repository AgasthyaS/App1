# AI in Greenr

Where a model is used, where it is deliberately not, which model, what it costs,
and how the key is kept safe.

Pricing and model availability were read on **2026-11-11** (Google) and
**2026-11-12** (OpenAI). Both change often. Re-check before relying on any
number here.

---

## What uses a model, and what does not

| Task | How it is done | Why |
|---|---|---|
| Sensor conversion, moisture trends, drying rate, daily light, VPD, watering advice, the evidence grade, the check-up | Ordinary code (`lib/`) | Deterministic, testable, free, and works offline. A language model adds cost and error to arithmetic. |
| Identifying a plant from a photo | Vision model, through the `identify-plant` edge function | The one task here that code cannot do. |
| Explaining advice in words | Templates in `lib/recommendation.ts` | The explanation must match the calculation exactly. Generated prose can drift from it. |
| Judging plant health from a photo | **Not built** | No basis for claiming accuracy. The check-up asks the owner what they see instead. |

One AI feature, one call per photo in the usual case.

---

## The key

The Gemini key supplied for this project was **checked and works** (it lists
models and completes requests). It was used from the command line for the
measurements below and is **not written anywhere in the repository**
(`grep -r` for it returns nothing).

Because it was pasted into a chat, treat it as exposed: create a new key in
Google AI Studio, delete the old one, and set the new one as a secret:

```bash
supabase secrets set GEMINI_API_KEY=<new key>
supabase functions deploy identify-plant
```

Rules the code follows:

- The key is read only inside the edge function (`Deno.env.get`). It never has an
  `EXPO_PUBLIC_` prefix, so it cannot be bundled into the app.
- The app calls the function with the user's Supabase session. The function
  verifies the session before doing anything.
- If the secret is missing the function returns `503 not-configured`, logs the
  exact command to fix it, and the app falls back to search by name.
- `.env.example` documents the variable with a placeholder.

### The key is on the free tier

Observed while testing: `gemini-3.8-flash` stopped after 20 requests with
"requests per day limit exceeded on Free Tier". Two consequences:

1. **Quota.** Free-tier limits are far too low for real users. Enable billing on
   the Google project before launch.
2. **Privacy.** Google's pricing page marks free-tier content as used to improve
   its products. Users' plant photos should not be sent on those terms. This is
   a second reason to enable billing first. The in-app privacy policy now names
   Google as the processor of identification photos.

---

## Model choice

### What is available and what it costs

Google list prices, USD per million tokens, standard tier, as read 2026-11-11.
Images are billed as input tokens.

| Model | Input | Output | Notes |
|---|---|---|---|
| `gemini-2.5-flash-lite` | 0.10 | 0.40 | **Refused for this account**: "no longer available to new users" |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 | |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | |
| `gemini-3.6-flash`, `gemini-3.8-flash` | 0.75 | 3.75 | doubles on 2027-01-01 |
| `gemini-4-argon`, `gemini-4-carbon` | 2.00 | 10.00 | doubles on 2026-12-01; no free tier |

OpenAI list prices as read 2026-11-12, for comparison: `gpt-5-nano` 0.05 / 0.40,
`gpt-6-luna` 0.10 / 0.50, `gpt-4o-mini` 0.15 / 0.60, `gpt-5.4-nano` 0.20 / 1.25,
`gpt-5-mini` 0.25 / 2.00. **These were not tested**: no OpenAI key was provided,
and the page does not say how those models bill images, so cost per photo cannot
be compared from the price list alone. On price per token alone the cheapest
OpenAI tiers are below Gemini Flash-Lite; whether they identify plants as well is
unknown. Running `scripts/eval-identify.ts` against them needs about thirty lines
for the different request format.

### What was measured

`scripts/eval-identify.ts`, 18 photos from Wikimedia Commons (17 plants, one
photo of chairs), run 2026-11-12 against the live API.

| Model | Image detail | Input tokens | Output tokens | Genus right | "High" answers right | Latency | Est. cost / photo |
|---|---|---|---|---|---|---|---|
| 3.1 Flash-Lite | low | 412 | 130 | 17 / 18 | 14 / 14 | 3.2 s | $0.00030 |
| 3.1 Flash-Lite | default | 1 233 | 127 | 17 / 18 | 14 / 14 | 3.7 s | $0.00050 |
| 3.5 Flash-Lite | low | 412 | 140 | 15 / 16 | 13 / 13 | 3.1 s | $0.00047 |
| 3.5 Flash-Lite | default | 1 232 | 128 | 17 / 17 | 13 / 13 | 2.0 s | $0.00069 |

What that shows:

- **Image size in pixels does not change cost.** A 384 px and a 768 px JPEG both
  billed about 1 233 input tokens at default settings.
- **The media-resolution setting does.** `MEDIA_RESOLUTION_LOW` cut input to 412
  tokens with no change in results on this set.
- **Confidence was honest.** Every answer marked "high" was right. The one miss
  (a single basil leaf, close up) came back "low" with "partial view". The
  chairs were rejected.
- About 2 in 18 photos met the rule for a second opinion.

What it does not show: accuracy. Eighteen photos, labelled by the search term
that found them, cannot support a percentage. It ranks options and checks that
the pipeline behaves. `gemini-3.6-flash` and `gemini-3.8-flash` could not be
measured because the free-tier daily quota ran out.

### Routing

```
photo ─▶ cache? ─yes─▶ return                                        $0
           │no
           ▼
   gemini-3.1-flash-lite, low detail                                 ~$0.0003
           │
   confident, or the photo itself is the problem? ─yes─▶ return
           │no  (about 1 in 9 on the test set)
           ▼
   gemini-3.5-flash-lite, full detail                                ~$0.0007
           │
   keep the more specific and more confident answer ─▶ return
```

- First pass is the cheapest setup that matched the best one on the test set.
- Escalation fires only when the top answer is low confidence, or medium and
  not at species level, **and** the photo is usable. A blurry or dark photo gets
  "retake it", not a more expensive model.
- Both models are overridable without a deploy: `IDENTIFY_MODEL`,
  `IDENTIFY_ESCALATION_MODEL` (set to `none` to disable).
- A stronger second model (`gemini-3.8-flash`) is the obvious thing to try next
  and needs a paid-tier key to evaluate.

---

## How cost is kept down

| Measure | Where | Effect |
|---|---|---|
| Low media resolution on the first pass | edge function | input 1 233 → 412 tokens |
| Short fixed prompt, system instruction separate | `_shared/identify.ts` | about 150 prompt tokens |
| Structured output with a schema, max 3 candidates, features under 15 words | same | output about 130 tokens; no prose to parse |
| `temperature: 0`, `maxOutputTokens: 500` | edge function | bounded output |
| Cache by SHA-256 of the image bytes + prompt version, per user | `ai_cache` | the same photo is never paid for twice |
| Daily limit of 20 fresh identifications per account | handler | caps the worst case at about $0.02 per user per day |
| Input rejected before any model call: size, type by magic bytes, encoding | handler | malformed requests cost nothing |
| Photo already resized to 720 px JPEG on the device | `CameraCapture.tsx` | 60–220 kB upload; fast on mobile data |
| Identification runs only when the user takes a photo in the add-plant flow | wizard | never on refresh, never on a sensor reading |
| No conversation history, no plant history, no database rows in the prompt | by design | context is the photo and two sentences |

The cache is per user on purpose. An identification is not personal, but
scoping it means no result ever crosses accounts.

---

## Validation: the model cannot write to the database

The model's text passes through `validateIdentification` before anything else
sees it: types checked, enums enforced, at most three candidates, strings
stripped of markup and bounded, names that are not plausibly botanical dropped.
Only that validated structure is stored or returned.

Then, on the device, `matchCatalog` maps each candidate to Greenr's species
catalog: exact botanical name first, renamed genera handled (Sansevieria and
Dracaena, Calathea and Goeppertia), and a genus-only answer offers the catalog's
species in that genus without picking one. A plant Greenr has no care record
for is shown as such, not mapped to a neighbour.

Nothing changes until the owner taps a candidate. Their choice is recorded
against the attempt as `confirmed`, `chose-alternative` or `corrected`, which
gives a running field measure of how often the first answer is right.

39 tests cover this path (`tests/identify.test.ts`), including injection
attempts in names, garbage output, cache behaviour, the daily limit, and
escalation.

---

## Usage tracking

Every request writes one `ai_usage` row: task, provider, model, input and output
tokens, estimated cost, latency, cache hit, success, error. Cache hits and
failures are logged too. Clients cannot read or write this table.

See it in the app under Settings → Usage → Data explorer, or:

```sql
select date_trunc('day', created_at) d, model, count(*) calls,
       sum(cost_usd) est_usd, round(avg(cache_hit::int), 2) cache_rate
  from ai_usage group by 1, 2 order by 1 desc;
```

`cost_usd` is an estimate from the list prices in `_shared/identify.ts`. The
invoice is the authority.

---

## Cost projection

Per photo, from the measured token counts and list prices:

```
first pass      (412·0.25 + 130·1.5)  / 10⁶ = $0.00030
second pass     (1233·0.30 + 130·2.5) / 10⁶ = $0.00069     on about 12 % of photos
blended         0.00030 + 0.12·0.00069       ≈ $0.00038 per identification
```

Assumptions, all of them guesses about behaviour, not measurements:

- An active user identifies **1.5 photos a month** on average (a few when they
  set up, occasionally after).
- 5 % of requests are cache hits.
- No free tier (it must not be used in production; see above).

| Active users | Identifications / month | Estimated monthly cost |
|---|---|---|
| 1 | 1.5 | under $0.001 |
| 100 | 150 | $0.05 |
| 1 000 | 1 500 | $0.54 |
| 10 000 | 15 000 | $5.40 |
| 100 000 | 150 000 | $54 |

Cost per active user: about **$0.0005 a month**. If usage were ten times the
assumption it would still be half a cent per user.

Worst case, every user at the daily limit every day: 600 photos × $0.001 = about
$0.60 per user per month. The limit exists to bound that.

At these volumes the edge function invocations and database rows cost more
attention than the model does. AI is not a meaningful line in Greenr's costs
unless a second, heavier AI feature is added.

---

## Not done

- **Not deployed.** The function has never run on Supabase. Its request logic is
  tested through injected dependencies; the Deno wrapper (`index.ts`) is not.
- **No OpenAI comparison beyond list prices.**
- **No evaluation on user-style photos.** Wikimedia images are better lit and
  better framed than a phone photo of a plant in a corner.
- **Stronger escalation models untested** (free-tier quota).
- **Paid-tier terms not confirmed.** The privacy policy now says photos go to
  Google for identification and are not stored by Greenr. It assumes a paid-tier
  key, whose content Google's pricing page says is not used to improve its
  products. Confirm that in the Google Cloud terms for your account before launch.
- **Photos are not stored server-side.** Only the hash and the result are. If a
  labelled image set is wanted later, that needs consent and a retention rule.
