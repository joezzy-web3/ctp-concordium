# Motion and polish rules (chosen direction: B, light bold)

Distilled from Emil Kowalski's animation skill and "Make Interfaces Feel Better" (Jakub Krehel), 19 Nov 2026.

## When to animate
| How often it happens | What we do |
|---|---|
| Landing hero, first order cleared, first setup done | The show: one orchestrated sequence |
| Moving between sections, opening a step, a verdict arriving | Standard: 200–300 ms, ease-out |
| Buttons, tabs, hovers (many times a day) | Near-invisible: press `scale(0.96)` 120 ms, colour transitions only |
| Typing, keyboard actions | No animation |

Every animated change also has a static cue (label, colour, icon). Motion is never the only signal.

## Ingredients
- Curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Never `ease-in` on UI.
- Only `transform` and `opacity` (plus `clip-path`). Never `scale(0)`: start at `scale(0.95)` + `opacity: 0`.
- CSS transitions for anything a person can trigger twice; keyframes only for the one-time hero sequence.
- Staggered entrances 60–80 ms apart, only for rare entrances.
- Exits softer than entrances: small `translateY`, same ease-out.
- Hover motion only under `@media (hover: hover) and (pointer: fine)`.
- `prefers-reduced-motion`: keep fades, drop movement.

## Polish
- `font-variant-numeric: tabular-nums` on amounts, counts and the hold countdown.
- `text-wrap: balance` on headings, `pretty` on body.
- Concentric radii: outer = inner + padding.
- Shadows for elevation, borders only for structure and state.
- Hit areas at least 40×40 px (44 on touch).
- Never `transition: all`.

## Choreography (Emil Kowalski, choreograph)
- Give every moving element a role: one lead, then support, then decoration; everything else stays still.
- Stagger by importance with shrinking gaps, never evenly. Hero: headline lines at 0, 110, 190 ms; sentence and button together at 240 ms with a shorter move, so the button is clickable almost at once.
- Secondary motion lands on the lead's key moment. Landing story: the seal stamps (1.55 s), the lock closes (1.85 s), then PROOF fills with gold (2.05 s): cause, then effect, slightly overlapping.
- One entrance per container; exits are simultaneous and softer.
- Moving between app sections uses the browser's view transitions; forward slides left, back slides right.

## Checks before shipping a page
- Hallmark's `sloplint` (tokens for every colour and font, 4 px spacing, one filled button per screen, short hero sentence, typographic quotes). Its own branding stamp is waived.
- Emil's break-ui: worst-case data (long names, no orders, a thousand orders, long addresses).

## Sources kept and dropped (19 Nov 2026)
Kept: Emil Kowalski (animate, choreograph, break-ui), Make Interfaces Feel Better, Hallmark (floor rules, sloplint), Taste (its never list), the view transition concepts from Vercel's skill, Stageshow (for the demo video).
Dropped: Impeccable (covered by the above), uizze (needs its paid service), UI UX Pro Max and Vercel's React/deploy skills (Tailwind, React and Vercel, which we do not use).
