# Design Scoring Calibration Examples

Read these examples BEFORE scoring any page. They anchor your scoring to consistent standards.

## Score 5 — Below Threshold (Generic Template)

**Characteristics:**
- Default framework colors (Tailwind gray-50 backgrounds, blue-500 buttons) with no customization
- Stock spacing — default padding/margin from utility classes, no intentional hierarchy
- No typography pairing — single font family, no size variation beyond h1/h2/p defaults
- Generic icons from default icon pack with no sizing or color coordination
- Layout is a single-column stack or basic sidebar — no grid sophistication

**Why it scores 5:**
- Design Quality: 5 — Works but looks like `npx create-next-app` with content added
- Originality: 4 — Zero custom decisions; every element is a library default
- Craft: 5 — Spacing is consistent (framework handles it) but not intentional
- Functionality: 6 — Usable, clear labels, but no affordance refinement
- Weighted: (7.5 + 6.0 + 3.75 + 4.5) / 4.5 = **4.8**

## Score 7 — Threshold Pass (Cohesive Design)

**Characteristics:**
- Custom color palette — 2-3 intentional brand colors, not framework defaults
- Spacing hierarchy — clear visual grouping with larger gaps between sections, tighter within
- Typography pairing — heading font differs from body, or clear size/weight scale (e.g., 32/24/18/14)
- Custom component styling — buttons, cards, inputs have border-radius, shadow, and color that feel coordinated
- Layout uses grid or intentional asymmetry — not just stacked blocks

**Why it scores 7:**
- Design Quality: 7 — Cohesive visual identity; you can tell someone made design decisions
- Originality: 7 — Custom palette and component styling distinguish it from templates
- Craft: 7 — Intentional spacing scale, consistent shadows, aligned elements
- Functionality: 7 — Clear action hierarchy, good feedback on interactions
- Weighted: (10.5 + 10.5 + 5.25 + 5.25) / 4.5 = **7.0**

## Score 9 — Excellent (Distinctive & Crafted)

**Characteristics:**
- Distinctive visual identity — memorable color scheme, unique layout patterns, brand personality
- Micro-interactions — hover states with transitions, loading skeletons, smooth page transitions
- Typography mastery — font pairing that creates mood (e.g., geometric sans for headings + humanist for body)
- Systematic spacing — 4px or 8px base grid visible in all measurements
- Responsive sophistication — not just "mobile works" but layout genuinely adapts (e.g., sidebar becomes bottom nav, grid reflows meaningfully)
- Consistent visual language — every page feels like the same product

**Why it scores 9:**
- Design Quality: 9 — Could be a shipped product; distinctive visual identity
- Originality: 9 — Unique design language; not recognizable as any template
- Craft: 9 — Pixel-level attention to spacing, alignment, color harmony
- Functionality: 8 — Intuitive flows, clear feedback, good error states
- Weighted: (13.5 + 13.5 + 6.75 + 6.0) / 4.5 = **8.8**

## How to Use These Anchors

1. Before scoring, recall the score-5, score-7, and score-9 examples
2. Place the page you are scoring relative to these anchors
3. A page that looks better than score-5 but not as cohesive as score-7 is a 6
4. A page between score-7 and score-9 is an 8
5. Score each criterion independently — a page can have score-8 craft but score-5 originality
