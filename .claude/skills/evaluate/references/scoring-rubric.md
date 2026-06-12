# Design Evaluation Scoring Rubric

Scores range from 1 to 10. Apply this rubric independently to each criterion.
Each score must be accompanied by a specific observation — not a general impression.

These four criteria match the sprint contract's `design_checks` keys and the design-critic's `eval-scores.json` output exactly.

---

## Criterion 1: Design Quality (1–10)

Measures visual coherence, color palette, layout structure, and whether the UI has a cohesive identity.

| Score | Exemplar |
|-------|----------|
| 1 | Broken or unusable: clashing colors, broken layout, elements overflow or overlap, no legible structure. |
| 4 | Functional but generic: the page works but looks like an unstyled template — inconsistent spacing, stock colors, no visual identity. |
| 7 | Polished and cohesive: intentional design choices are evident, color palette is consistent, layout structure guides the eye. Minor issues remain (e.g., one section's spacing is off). |
| 10 | Exceptional: could be a real product. Distinctive visual identity, every element reinforces the brand, nothing feels accidental. |

---

## Criterion 2: Originality (1–10)

Measures the degree of customization relative to raw library defaults (Tailwind, MUI, Bootstrap, etc.).

| Score | Exemplar |
|-------|----------|
| 1 | Zero customization: raw library defaults throughout, no brand color, no custom component design, looks like every other project using the same library. |
| 4 | Minor customization: a custom primary color or font swap, but the layout and component shapes remain template-like. |
| 7 | Distinctive identity: custom component design, unique color scheme, interactions that go beyond the library's out-of-the-box behavior. |
| 10 | Genuinely creative: unique design language, memorable experience, design choices that would not appear in any default template. |

---

## Criterion 3: Craft (1–10)

Measures typography hierarchy, spacing system, alignment, and color harmony — the execution quality of the design decisions.

| Score | Exemplar |
|-------|----------|
| 1 | No hierarchy: same font size and weight everywhere, random spacing, misaligned elements, colors clash. |
| 4 | Basic: some typographic hierarchy exists, spacing is mostly consistent but not systematic, colors are compatible but not harmonious. |
| 7 | Refined: clear typographic scale (H1/H2/body/caption), systematic spacing, intentional color use with good contrast. Minor gap: one element breaks the spacing rhythm or a secondary color is slightly off. |
| 10 | Meticulous: pixel-perfect alignment, modular spacing scale applied everywhere, harmonious palette with purposeful accent use, every text element sits in the right place in the visual hierarchy. |

---

## Criterion 4: Functionality (1–10)

Measures whether users can understand and complete tasks: clear affordances, obvious actions, timely feedback for loading/success/error/disabled states.

| Score | Exemplar |
|-------|----------|
| 1 | Unusable: key actions are hidden or broken, form submissions produce no visible result, errors appear only in the browser console. |
| 4 | Learnable but effortful: the page works but requires trial-and-error — submit button disables on click but no loading indicator appears, errors show as raw JSON. |
| 7 | Intuitive: clear hierarchy, obvious primary action, loading spinner appears within 200ms, success/error messages are human-readable and specific. Minor gap: error toast auto-dismisses too quickly. |
| 10 | Delightful: optimistic UI updates with rollback on error, progress indication for long operations, every disabled state is visually distinct and carries aria-disabled, feedback persists until resolved. |
