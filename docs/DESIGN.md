# Greenr design notes

What the visual system is, what changed in this overhaul, and what did not.

## Honest scope

This overhaul did **not** redesign every screen. The existing interface was
already a coherent, competent iOS-style design (`constants/theme.ts`,
`components/greenr/UI.tsx`, `Native.tsx`), and the engineering time went to the
science, the database and the identification feature. The design work here is:

1. Six new surfaces, built on the existing tokens so they belong.
2. Removal of two things that looked finished and were not (fake identification
   confidences, simulated diagnosis).
3. Wording that stops claiming more than the app knows.

A brand-level redesign (typeface, palette, dashboard, plant pages) is still to
do and is scoped at the end.

## The system as it stands

- **Two palettes.** A live "instrument" palette that follows the phone's light or
  dark setting, and a warm "ritual" palette for onboarding and setup. Screens
  read colours at render time from `dark`, `light` and `accent`.
- **Type.** The platform system font, in an Apple-style scale. Numbers are
  tabular and one weight heavier than labels.
- **Layout.** 4-point grid, 16-point margins, 20-point card radius, 44-point
  minimum touch targets.
- **Colour meaning.** Sage: in range. Sunbeam: caution. Clay: needs action,
  used sparingly. Verdant: interactive.

## New in this overhaul

| Surface | File | What it does |
|---|---|---|
| Photo suggestion card | `AddPlantWizard.tsx` | The photo, up to three candidates with the visible features behind each, a plain confidence word, genus-level choices when the model stops at genus, and photo advice when the picture is the problem. Always followed by search. |
| Substrate picker | `SubstratePicker.tsx` | Eight common choices, "My own mix", "Not sure", and the rest behind "More". A readout shows water held and air as ranges. |
| Substrate screen | `app/substrate/[id].tsx` | The picker plus a scale showing where "full" and "running low" land for this pot against the plant's range. |
| Advice card | `AdviceCard.tsx` | One line and an evidence grade; opens to the seven-step reasoning and the nine checks. |
| Observation card | `ObservationCard.tsx` | "How does it look?" in two taps. |
| Check-up | `app/diagnose/[id].tsx` | Measured conditions, what the owner sees, and leads where they meet. |
| Soil scale capture | `SoilRangeCard.tsx` | Four numbered steps to give a sensor its own air and water readings. |
| Data explorer | `app/explorer.tsx` | Operator view of the dataset. |

Patterns these share:

- **Ranges are drawn as ranges.** An estimate gets a faint band and a mark, not a
  single bar that implies precision.
- **Every estimate says it is one**, in the same place on every card.
- **Reasoning is one tap away, never in the way.** Collapsed by default.
- **A plain word before a number.** "Likely", "Drying", "Well founded".
- **Nothing is only colour.** Each state has an icon and a word.

All were checked in a browser at phone width in light and dark, and one layout
collision found that way was fixed.

## Wording changes

| Before | After | Why |
|---|---|---|
| "96%", "88%", "81%" on three fixed species | removed | they were constants, not results |
| "Photo diagnosis", with percentages | "Check-up", no percentages | the analysis was a four-second timer |
| "7 of 9 plants are healthy" | "7 of 9 plants have good conditions" | the score rates conditions, not the plant |
| "Soil 44%" in advice | "Soil moisture index 44" | it is not a percentage of water |
| Greenr+ lists "photo diagnosis" | removed from five places | the feature does not exist |

Still to change: the score's own words ("Thriving", "Stable", "Stressed",
"Critical") describe a plant, and the soil figure elsewhere in the app is still
shown with a percent sign.

## Not done, in priority order

1. **A typeface with character.** Figtree is already a dependency and unused.
   Titles in Figtree, body in the system font, would give the app a recognisable
   voice for one font load.
2. **Photo-led plant cards and plant page header.** Photos exist per plant and
   are shown small. They should lead.
3. **Home.** It answers "what needs me today" well. It does not yet show "what
   changed", and the milestone card competes with the to-do list.
4. **The plant page is 3 700 lines and very long on screen.** It needs tabs
   (Now, History, Care, Setup) more than it needs restyling.
5. **Charts from daily summaries**, with watering markers, gaps drawn as gaps,
   and calibration changes marked.
6. **Tablet and desktop layouts.** The web build is a phone layout at any width.
7. **Reduced-motion and screen-reader pass** across existing screens. New
   components set roles and labels; the older ones were not audited.
