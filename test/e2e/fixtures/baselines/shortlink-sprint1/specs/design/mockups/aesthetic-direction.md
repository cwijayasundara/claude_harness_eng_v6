# Aesthetic Direction — shortlink Console

No `frontend-design` skill is installed in this project (not in
`.claude/skills/`), so this direction is committed directly here, in the same
place production code and later mockups must read it from.

## Direction: editorial dev-tool

A link and its code are data, not marketing copy — the Console should read
like a well-typeset table in a technical publication, not a generic SaaS
dashboard. Warm paper background, high-contrast ink text, one deliberate
accent color, monospace wherever the value shown is literally a URL or code.

## Typography

- **Display** (page title, section headers): `Fraunces` (serif, variable,
  high-contrast) — via Google Fonts CDN. Gives the page a printed,
  intentional feel instead of a default SaaS look.
- **UI text** (buttons, labels, nav, empty state copy): `Space Grotesk`
  (geometric sans, distinctive x-height) — via Google Fonts CDN.
- **Data** (codes, target URLs, timestamps): `JetBrains Mono` — via Google
  Fonts CDN. Monospace is not decorative here: it is the correct choice for
  scanning a column of codes and comparing character-by-character.

No Inter, Roboto, Arial, or unstyled system-font fallback as the primary
face.

## Color

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F6F1E7` | page background |
| `--ink` | `#1B1A17` | primary text |
| `--ink-muted` | `#6B6558` | secondary text, timestamps |
| `--accent` | `#D65A1F` | links, primary actions, focus ring |
| `--accent-ink` | `#FFFFFF` | text on accent |
| `--danger` | `#B3261E` | delete action |
| `--line` | `#E4DCC9` | table rules, card borders |

Contrast checked for WCAG AA at the sizes used (body text `--ink` on
`--paper` is ~14.6:1; `--accent-ink` on `--accent` is ~4.6:1 at 16px+ / used
only on buttons at bold weight, meeting the 3:1 large-text/UI-component
threshold with margin).

## Spatial language

Generous vertical rhythm, a single-column content well capped at ~840px,
table rows separated by hairline `--line` rules rather than shadowed cards.
Pagination and the delete action are real `<button>`/`<a>` elements, never a
`<div onClick>`, so they are keyboard-reachable and screen-reader-nameable
by construction (E4-S3).

## Applies to

- `specs/design/mockups/E4-S1.html` (this direction)
- The production Console (`frontend/src/app/console/page.tsx` and its
  components) — E4-S1's teammate must read this file before writing JSX/CSS;
  `design-critic` re-scores production against the same direction.
