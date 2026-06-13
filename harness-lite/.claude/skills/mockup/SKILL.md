---
name: mockup
description: Create a UI mockup, component, or page as a disposable artifact. No SDLC pipeline, no evaluator, no security review.
---

# mockup — UI Mockup / Component

Produces a self-contained UI artifact for review or discussion. **Disposable artifact** lane — no pipeline, no generator/evaluator GAN loop, no ratchet gates.

## Flow

1. **Prefer `frontend-design`.** If the `frontend-design` skill is available, invoke it — it is purpose-built for distinctive, production-grade UI and avoids generic AI aesthetics. Pass along the user's intent, target screens, and any brand/style constraints.

2. **If `frontend-design` is not installed,** produce the mockup inline:
   - A single self-contained `.html` file with all CSS and JS inlined (no external build step). CDN React + Tailwind is fine for richer mockups.
   - Realistic mock data, not lorem ipsum.
   - Show the primary happy-path state; include at least one empty/error state as a toggle or commented section.
   - Label interactive elements with their intended action where it aids review.

3. **Write** to `mockups/` (or a path the user names) and report the file path. Do not wire it to a backend, write tests, or run any verification gate — it is a mockup.

If the mockup is going to become a real shipped component, that is a deliberate switch to the full `claude_harness_eng_v5` loadout and the SDLC pipeline.
