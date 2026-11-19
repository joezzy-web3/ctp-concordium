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
