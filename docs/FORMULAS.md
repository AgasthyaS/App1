# Greenr formula inventory

Every calculation that changes what a user sees, with its definition, units,
assumptions, limits and tests.

**Status** column:

- **new** added in this overhaul
- **changed** existed, replaced or corrected in this overhaul
- **kept** existed, reviewed, left as it was
- **kept, unverified** existed and is plausible, but rests on something that has not been checked against measurements

**Validation** column says what kind of evidence stands behind it. Nothing in this
document has been validated against Greenr hardware in soil. "Unit" means it
computes what its definition says; "reference" means it reproduces a published
number; "simulated" means it behaves coherently on generated traces. None of
those is evidence of real-world accuracy.

Run everything: `npm test` (274 tests).

---

## 1. Soil signal

| # | Name | File | Status |
|---|---|---|---|
| 1.1 | Raw validation | `lib/sensing/moisture.ts` | new |
| 1.2 | Moisture index | `lib/sensing/moisture.ts` | changed |
| 1.3 | Offset correction | `lib/calibration.ts` | kept |
| 1.4 | Weighed calibration curve | `lib/sensing/moisture.ts` | new |
| 1.5 | Trace consistency | `lib/sensing/moisture.ts` | new |
| 1.6 | Index → water content (Topp) | `lib/soilProfile.ts` | kept, unverified |

### 1.1 Raw validation

Classifies a stored count without changing it.

| Count | Verdict |
|---|---|
| not finite, < 0, > 4095 | `invalid` |
| 0–100 | `legacy-index` (row from firmware that converted on-device) |
| 101–199 | `disconnected` |
| ≥ dry endpoint + 100 | `not-inserted` |
| < wet endpoint − 250 | `beyond-wet` |
| otherwise | `ok` |

Assumes a connected probe never reads below 200. That is the same assumption the
app already made; it is now stated and tested.

### 1.2 Moisture index

```
index = 100 · (dry − raw) / (dry − wet)      clamped to 0…100
```

`raw` ADC counts; `dry`, `wet` the counts with the blade in air and in water.
Output is unit-free.

- **Before:** one pair (3020, 1400) for every sensor.
- **Now:** each sensor's own pair when captured, the factory pair otherwise. A
  pair is accepted only if `dry − wet ≥ 400` and both are within the converter's range.
- **What it is not:** water content. The probe's response is not linear in water
  and shifts with substrate, salts, temperature and packing. The UI calls it a
  moisture index.
- **Why it matters:** a simulated second probe with endpoints 170 counts lower
  reads more than 5 index points off through the factory pair, and exactly right
  through its own (test: "two sensors with different endpoints agree").
- **Unverified:** the factory pair was measured on an ESP32 dev kit. An ESP32-C3
  has a different converter range. See [HARDWARE.md](HARDWARE.md).

### 1.4 Weighed calibration curve

Water content from weighing the pot:

```
θ = (m_now − m_dry) / (ρ_w · V)        g, g, 1 g/cm³, cm³  →  cm³/cm³
```

Three or more `(index, θ)` points are interpolated with a monotone cubic
(Fritsch and Carlson 1980). A polynomial was rejected because with four or five
points it can oscillate and report less water for a wetter reading; the monotone
interpolant cannot. Outside the measured range the end values are held.

Implemented and tested. **No screen collects the weighings yet**, so no user has
a curve and the app never states a water content.

### 1.5 Trace consistency

```
r_i   = x_i − median(x_{i−2 … i+2})
scale = max(0.5, 1.4826 · median(|r|))
outlier if |r_i| > 3.5·scale and |r_i| > 4
inconsistent if outliers > 20 % of the last 24 readings,
             or ≥ max(3, 25 %) direction reversals larger than 4 points
```

1.4826 converts a median absolute deviation to a standard deviation for normal
noise. The 4-point floor stops a perfectly quiet trace flagging its own last-bit
flicker. A single watering step is not an outlier (tested).

### 1.6 Index → water content

```
Ka = 1 + 79 · index/100
θ  = −0.053 + 0.0292·Ka − 5.5e-4·Ka² + 4.3e-6·Ka³        Topp et al. 1980
```

Then scaled so a full dry-to-capacity soak is 27 % of pot volume.

**Unverified assumption:** that the index is linear in permittivity. A
capacitive probe's output stage is not linear in capacitance, and published
characterisations of this class of sensor show the opposite curvature at the
dry end. It is used only as a prior for millilitres per point and is replaced by
the pot's own measured figure after two logged pours. Checking it needs the
weighed calibration in 1.4.

---

## 2. Substrate

| # | Name | File | Status |
|---|---|---|---|
| 2.1 | Retention curve | `lib/substrate/vg.ts` | kept (moved) |
| 2.2 | Curve fit | `lib/substrate/vg.ts` | new |
| 2.3 | Mineral textures | `lib/substrate/components.ts` | new |
| 2.4 | Horticultural ingredients | `lib/substrate/components.ts` | new |
| 2.5 | Blend model | `lib/substrate/mixture.ts` | new |
| 2.6 | Container tensions | `lib/soilProfile.ts` | kept |
| 2.7 | Hydrostatic profile and probe band | `lib/soilProfile.ts` | kept |
| 2.8 | Thresholds for a pot | `lib/soilProfile.ts` | changed (accepts any substrate) |

### 2.1 Retention curve (van Genuchten 1980)

```
θ(ψ) = θr + (θs − θr) / [1 + (α·ψ)^n]^m ,   m = 1 − 1/n
```

ψ suction in cm of water; θ in cm³/cm³; α in 1/cm; n > 1. Assumes one population
of pores. A blend of chunks and fines has two, and the fit error is reported.

### 2.2 Curve fit

Least squares for α and n with θs, θr fixed, by a 61×61 grid over log₁₀α ∈ [−3, 0.7]
and n ∈ [1.05, 4] followed by three local refinements. A grid, not a gradient
method: the error surface has a curved valley and descent from a fixed start
lands in different places for different inputs. Recovers known parameters to two
decimals (tested).

### 2.3 Mineral textures

The twelve USDA classes with the class-average parameters of Carsel and Parrish
(1988), *Water Resources Research* 24:755–769. Checked against a second
transcription on 2026-11-11.

Applied to pots with a caveat: these are field soils. A consequence the model
reproduces without being told is that fine soils hold almost no air at container
capacity (under 5 % for loam, clay loam, silt loam, clay), which is why garden
soil performs badly in pots.

### 2.4 Horticultural ingredients

Each has total porosity, water at about 5 cm, 50 cm and 100 cm of suction, a
residual, and for coarse materials the void between particles. A curve is fitted
through them (RMSE under 0.02 for all).

| Tier | Ingredients | Basis |
|---|---|---|
| published-anchors | peat, coir, pine bark, perlite, bagged potting mix | porosity and air space from University of Arkansas Greenhouse Management Unit 7; the 50 and 100 cm points are typical magnitudes |
| typical-magnitude | pumice, vermiculite, orchid bark, sphagnum moss, compost, grit | representative of the container-media literature; not traceable to one measurement |

Peat and coir were set so that 80:20 blends with perlite reproduce the published
figures. Each ingredient carries a spread of ±0.05 to ±0.12 v/v for product
variation. **None has been measured by Greenr.**

### 2.5 Blend model

Ingredients as bulk-volume fractions `f_i`, split into coarse skeleton (`f_c`,
interparticle void `e`) and fine matrix (`f_f`).

```
V_ideal = f_c                 if f_f ≤ e·f_c
          f_c·(1 − e) + f_f   otherwise
V(η)    = 1 − η·(1 − V_ideal)              η = 0 no nesting, 1 ideal nesting
θ_mix(ψ) = Σ f_i·θ_i(ψ) / V
TP_mix   = (Σ f_i·TP_i − (1 − V)) / V
```

Reported as a range from η = 0 to η = 1, with η = 0.5 as the working value, plus
the ingredients' spreads combined in quadrature. An effective van Genuchten
curve is fitted to the η = 0.5 result for use in the container model.

- **Why not a volume-weighted average:** fines fill the gaps between coarse
  particles. Averaging overstates air and understates water. The model gives the
  known threshold effect (Spomer 1979): the threshold coarse fraction is
  `1/(1+e)`, about 71 % for perlite, and aeration barely changes below it.
- **Checked against three published blends** (4-inch containers):

  | Blend | Water held: model / published | Porosity | Air |
  |---|---|---|---|
  | 80:20 peat–perlite | 0.70 / 0.68 | 0.82 / 0.79 | 0.12 / 0.10 |
  | 80:20 coir–perlite | 0.73 / 0.73 | 0.83 / 0.81 | 0.10 / 0.08 |
  | 50:50 coir–pine bark | 0.67 / 0.65 | 0.83 / 0.78 | 0.16 / 0.13 |

  The first two informed the peat and coir anchors, so only the third is an
  independent check. Three blends is a sanity check, not a validation.
- **Assumes** rigid particles, two size populations, and that an ingredient
  holds the same water blended as alone. Ignores compaction and decomposition.

### 2.6 Container tensions

Field capacity (330 cm) and wilting point (15 000 cm) are **not** used. A pot
drains under its own height, so the partitions of De Boodt and Verdonck (1972)
apply:

```
container capacity   θ(10 cm)
easily available     θ(10) − θ(50)
buffer               θ(50) − θ(100)
```

`AWC = θ_FC − θ_PWP` with field values would credit a pot with a reservoir it
does not have. This was already correct in the code and is kept.

### 2.7 Hydrostatic profile

At equilibrium the suction at height z above the pot's base is z cm, so
`θ(z) = θ_vG(z + d)`, where d is how far the water table has fallen as the pot
dried. The probe reports the mean over the top 6.5 cm. Kept.

### 2.8 Thresholds for a pot

Capacity, refill and stress readings are found by bisection on d so that the
root zone reaches each tension, then read off as what the probe would show. Now
takes any substrate from the library. A plant with no library substrate gets
exactly the curve it had before (tested for all four original classes at three
pot depths).

---

## 3. Watering

| # | Name | File | Status |
|---|---|---|---|
| 3.1 | Pot volume | `lib/watering.ts` | kept |
| 3.2 | Dry-down fit | `lib/soilRetention.ts` | kept |
| 3.3 | Millilitres per point | `lib/waterBalance.ts`, `lib/hydration.ts` | kept |
| 3.4 | Schedule | `lib/waterBalance.ts` | kept |
| 3.5 | Water decision | `lib/waterAction.ts` | kept |
| 3.6 | Recommendation states | `lib/recommendation.ts` | new |
| 3.7 | Days to the floor | `lib/recommendation.ts` | new |
| 3.8 | Evidence grade | `lib/recommendation.ts` | new |
| 3.9 | Sensorless interval | `lib/estimate.ts` | kept, unverified |

### 3.1 Pot volume

`V = π·(d/2)²·h·k / 1000` litres, d and h in cm, k = 1.0, 0.81 or 0.65 for
straight, tapered and very tapered pots. Inputs bounded to 5–80 cm and 3–200 cm.

### 3.2 Dry-down fit

`x(t) = x∞ + (x₀ − x∞)·e^(−t/τ)`, fitted as a line through `ln(x − x∞)` against
time, per run between waterings, corrected for evaporative demand by VPD. A run
needs 18 h, 5 readings, a 5-point drop and R² ≥ 0.75. Days from full to due
= 0.92·τ.

### 3.4 Schedule

Refill line = the higher of the species floor and the substrate's refill reading
(species floor alone for soak-and-dry plants). Interval from the fitted curve:
`t = τ·ln((from − x∞)/(to − x∞))`.

### 3.6 Recommendation states

Nine states (see `lib/recommendation.ts`). The substrate threshold produces
"drying" but never "water now": it is a modelled figure, and watering too early
is the costlier error for a houseplant. Tested: no substrate turns "drying" into
a pour.

### 3.7 Days to the floor

```
t = τ · ln( (x − x∞) / (lo − x∞) )
```

x the current index, lo the species floor, τ and x∞ from 3.2. Returned only when
a dry-down has been measured for this pot. Falls back to `(x − lo) / rate` if
the curve cannot be evaluated, and to null otherwise.

Found during this work: the first version projected to the substrate threshold
and produced "index 32 … reaches 49 within a day". It now targets the floor, and
a test asserts a projection never names a level the soil is already below.

### 3.8 Evidence grade

Not a probability. A count against nine fixed checks.

| Check | Required | Met when |
|---|---|---|
| Recent reading | yes | age ≤ max(8 h, 2.5 × median reporting gap) |
| Probe in the soil | yes | signal in range and insertion checks pass |
| Steady trace | yes | 1.5 says consistent, with at least 8 readings |
| Sensor calibrated | | own endpoints captured |
| Substrate known | | not "unknown" |
| Drying measured | | a confident dry-down fit exists |
| Amount measured | | at least one clean logged pour |
| Species record | | curated record, not a category baseline |
| Pot measured | | width and depth both set |

```
none      no usable reading
low       a required check fails, or fewer than 3 supporting
moderate  required met and ≥ 3 supporting
high      required met, drying measured, and ≥ 5 supporting
```

The thresholds are judgement. What makes it defensible is that every input is a
yes-or-no fact shown to the user. It says how much of the answer is measured. It
does not say the answer is right.

### 3.9 Sensorless interval

Species base interval × pot size (0.8 or 1.25) × material (0.85 terracotta, 1.1
plastic) × season. The multipliers are rules of thumb with no measurements
behind them. They apply only to plants without a sensor.

---

## 4. Light

| # | Name | File | Status |
|---|---|---|---|
| 4.1 | Raw → index | `lib/devices.ts` | kept |
| 4.2 | Rail detection | `lib/sensing/light.ts` | new |
| 4.3 | Index ↔ illuminance | `lib/lightModel.ts` | kept, unverified |
| 4.4 | Illuminance → PPFD | `lib/lightModel.ts` | kept |
| 4.5 | Daily light | `lib/lightModel.ts`, `lib/insights.ts` | **changed** |
| 4.6 | Divider model | `lib/sensing/light.ts` | new, not wired in |
| 4.7 | Light verdict | `lib/plantStatus.ts`, `lib/insights.ts` | changed (one definition) |

### 4.3 Index ↔ illuminance

`lux = 80 · (65000/80)^(index/100)`. A log interpolation between assumed
endpoints. No physical derivation and no calibration behind the endpoints.

### 4.5 Daily light

```
DLI = (1/10⁶) ∫ PPFD(t) dt          µmol·m⁻²·s⁻¹ over seconds → mol·m⁻²·day⁻¹
    ≈ PPFD_mean · photoperiod_seconds / 10⁶
```

- **Before:** the index was averaged, then converted. The index is logarithmic,
  so that is the geometric mean of the light, which is always below the true
  average when light varies.
- **Now:** each sample is converted to illuminance first, the trapezoid is taken
  in linear units, and the result is mapped back to an index only for display.

  ```
  Ē = Σ w_i · (lux_i + lux_{i+1})/2 / Σ w_i        ī = index(Ē)
  ```
- **Size of the correction:** a day at index 20 half the time and 70 the other
  half averaged 45 before and about 60 now. In daily-light terms the old figure
  was low by a factor of about 2.8 (tested as > 2).
- Weights are the hours each interval overlaps daylight or bright artificial
  light. Gaps longer than 1.5× the median reporting interval are not bridged.
- Still an **estimate with a stated factor-of-two band**, because 4.3 is
  uncalibrated. Hours spent at the bright rail are now recorded
  (`saturatedHours`) so a day can be called a lower bound.
- With one reading every three hours a day has four or five daylight samples.
  The integration is correct; the sampling is coarse.

Stored 14-day averages computed before this change are on the old definition
and age out over two weeks.

### 4.6 Divider model

```
R_ldr = R_fixed · x/(1 − x)            x = raw/4095
E     = 10 lx · (R_10 / R_ldr)^(1/γ)
```

With datasheet-typical parts (10 kΩ, R₁₀ = 12 kΩ, γ = 0.7) the divider stops
resolving at a few thousand lux (tested as < 10 000). Direct sun is 50 000 or
more. So the sensor very likely cannot tell bright shade from full sun, and the
65 000 lx top of scale in 4.3 is probably wrong by an order of magnitude.

This is implemented and tested but **not used for advice**, because R_fixed, R₁₀
and γ are not known for the module in use. `calibrateLdr` fixes R₁₀ from one
reference lux reading; a screen to collect it has not been built.

---

## 5. Air

| # | Name | File | Status |
|---|---|---|---|
| 5.1 | Saturation vapour pressure | `lib/vpd.ts` | kept |
| 5.2 | Vapour pressure deficit | `lib/vpd.ts`, SQL `vpd_kpa` | kept, mirrored in SQL |
| 5.3 | VPD bands | `lib/vpd.ts` | kept |

```
e_s(T) = 0.61078 · exp(17.27·T / (T + 237.3))     kPa, T in °C     Tetens 1930
VPD    = e_s(T) · (1 − RH/100)                    kPa
```

Reference values at 0, 20, 25, 30 °C reproduce to two decimals (tested). The SQL
and TypeScript versions agree to six decimals (tested).

**Is VPD worth having?** Yes for one purpose: correcting the drying rate for how
thirsty the air was, which is what lets a dry-down measured in a warm week
predict a cool one. As a number shown to a user it is of little use on its own,
so it appears in the check-up in plain words. The band limits (0.4–1.6 kPa,
0.8–1.2 ideal) are greenhouse guidance for actively growing crops and are only
indicative for houseplants.

Caveat: this is air VPD. Leaf VPD needs leaf temperature, which is not measured.
The AHT10 sits inside the sensor housing and may read warm.

---

## 6. Scores and statistics

| # | Name | File | Status |
|---|---|---|---|
| 6.1 | Conditions score | `lib/health.ts` | kept, wording changed |
| 6.2 | Species band blend | `lib/empirical.ts` | kept |
| 6.3 | Daily statistics | `lib/dailyStats.ts`, SQL `reading_daily` | kept; SQL new |
| 6.4 | Offline gap | `lib/devices.ts` | kept |
| 6.5 | Population aggregates | SQL `research.*` | kept; three new |

### 6.1 Conditions score

`moisture 30 + light 25 + temperature 25 + humidity 20`. Each component is full
marks inside the species range and falls linearly to zero `soft` units outside.

The weights are a design choice, not a measurement. The score rates the
conditions a plant is in. It cannot see the plant. Home now says "7 of 9 plants
have good conditions". The words "Thriving / Stable / Stressed / Critical" on
the score are still plant-health words and should be reconsidered.

### 6.2 Species band blend

`w = min(1, log₁₀(n/10) / log₁₀(20))` for n ≥ 20 plants, 0 below. The measured
band replaces the book band in proportion to w. A sample-size-weighted shrinkage,
which is the right tool while the pooled dataset is empty. A hierarchical model
becomes worth building once there are a few hundred plants per species.

### 6.5 Population aggregates

Medians and quartiles per group, one value per plant, opted-in accounts only,
returned only at 15 distinct plants and 5 growers. Tested: 30 measurements from
2 plants stay hidden; 18 plants from 6 growers appear; 20 plants from an
opted-out account do not count.

These are associations. `drying_by_vpd` in particular compares different pots in
different homes, and warm dry rooms differ from cool damp ones in more than VPD.

---

## 7. Check-up

`lib/checkup.ts`. A table of 17 pairings between a reported symptom and a
measured condition out of range (wilting with dry soil, yellowing with wet soil,
stretching with low light, brown tips with dry air, and so on). A lead is shown
only when both halves are present, and quotes the measurement.

No probabilities. Symptoms with no matching measurement are listed as
unexplained, with the causes a sensor cannot see.

---

## What would validate each open item

| Item | Experiment |
|---|---|
| 1.2 factory endpoints on ESP32-C3 | read ten sensors in air and water on the real board |
| 1.6 index → water content | weigh three pots per substrate from saturated to dry, logging raw counts |
| 2.4 ingredient anchors | NCSU porometer or EN 13041 measurements on the actual products |
| 2.5 blend model | the same, on five or six blends across the threshold |
| 2.8 thresholds | compare modelled "full" with the reading an hour after a thorough watering, per substrate |
| 3.2 dry-down fit | already self-validating: residuals of the fit are stored per run |
| 4.3 and 4.6 light | a lux meter beside the sensor at ten levels from 50 to 50 000 lx |
| 3.8 evidence grade | once `recommendations.outcome` accumulates, check that higher grades predict the soil's response better |
