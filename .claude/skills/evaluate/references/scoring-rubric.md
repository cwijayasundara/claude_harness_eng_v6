# Design Evaluation Scoring Rubric

Scores range from 1 to 10. Apply this rubric independently to each criterion.
Each score must be accompanied by a specific observation — not a general impression.

---

## Criterion 1: Visual Hierarchy

Measures whether the UI communicates importance through size, weight, spacing, and color contrast.

| Score | Exemplar |
|-------|----------|
| 1 | All elements appear at the same visual weight. No distinction between headings, body, and supporting text. Page reads as a flat wall of content. |
| 4 | Primary headings are slightly larger than body text. Some sections have padding but margins are inconsistent. The most important action is not visually prominent. |
| 7 | Clear H1/H2/body text scale. Primary CTA button is visually dominant. Grouping via whitespace is consistent. Minor issues: secondary actions compete slightly with primary. |
| 10 | Purposeful typographic scale at every level. Primary actions are immediately obvious. Supporting content recedes appropriately. A user's eye follows a clear path from entry point to action. |

---

## Criterion 2: Accessibility

Measures WCAG 2.1 AA compliance for keyboard navigation, color contrast, ARIA labels, and focus management.

| Score | Exemplar |
|-------|----------|
| 1 | No keyboard navigation possible. Color-only error indicators. Interactive elements have no accessible names. Focus is not visible. |
| 4 | Tab order exists but skips some interactive elements. Contrast ratio on body text is ≥ 4.5:1 but fails on placeholder text. Some form labels are present but icons have no aria-label. |
| 7 | All interactive elements are keyboard reachable and have visible focus rings. Form inputs have associated labels. Contrast meets AA. One minor gap: modal does not trap focus correctly. |
| 10 | Full keyboard navigation with logical tab order. All images have descriptive alt text. Focus traps work in modals/dialogs. Contrast meets AA at every element. Screen reader announces live region updates. |

---

## Criterion 3: Responsiveness

Measures whether the layout adapts correctly across mobile (375px), tablet (768px), and desktop (1280px+) breakpoints.

| Score | Exemplar |
|-------|----------|
| 1 | Fixed-width layout overflows on mobile. No viewport meta tag. Content is cut off or requires horizontal scrolling on any screen under 1024px. |
| 4 | Layout reflows at mobile but navigation collapses to an unusable state. Images overflow their containers on tablet. Text is readable but tap targets are below 44px on mobile. |
| 7 | Three-column desktop layout reduces to single column on mobile cleanly. Navigation collapses to a hamburger menu that functions correctly. Tap targets meet 44px minimum. Minor gap: table does not scroll horizontally on small screens. |
| 10 | Fluid grid adapts at all breakpoints with no overflow. Images use responsive srcset. Navigation, forms, tables, and modals all handle every tested viewport. Touch targets meet 44px minimum everywhere. |

---

## Criterion 4: Interaction Feedback

Measures whether the UI gives users clear, timely feedback for actions (loading, success, error, disabled states).

| Score | Exemplar |
|-------|----------|
| 1 | Buttons give no feedback when clicked. Form submissions produce no visible result. Errors are surfaced only in the browser console. |
| 4 | Submit button disables on click but no loading indicator appears. Success is shown as a plain alert(). Errors appear as raw JSON or generic "Something went wrong" with no recovery path. |
| 7 | Loading spinner appears within 200ms of submission. Success toast displays with a clear message. Validation errors are shown inline next to fields. Minor gap: error toast auto-dismisses before the user can read it on slow connections. |
| 10 | Optimistic UI update with rollback on error. Loading state includes progress indication for long operations. Success and error messages are specific and actionable. Disabled states are visually distinct and carry aria-disabled. All feedback persists until user acknowledges or action resolves. |
