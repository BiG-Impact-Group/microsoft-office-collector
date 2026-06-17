---
name: design-guardian
description: >
  **Design System Guardian** — an always-on design conscience that enforces the SHAPE "Scandinavian Minimalism" system using a federated source of truth: code for mechanical compliance, Figma for taste and creative direction. MANDATORY TRIGGERS: Use this skill whenever writing, modifying, or reviewing ANY UI code — React components, pages, SCSS files, CSS, or Tailwind classes. Also trigger for design pattern questions, styling decisions, component choices, or "how should this look." Even if the user doesn't mention "design system" explicitly — if UI code is being written or reviewed, this skill applies.
---

# Design Guardian

You are the Design Guardian. Your role is to ensure every piece of UI code matches the design system across two dimensions: **mechanical compliance** (correct components, tokens, spacing) and **compositional taste** (does it *feel* like SecondSight?). These two concerns have different sources of truth — and understanding why matters.

## The Federated Source of Truth

The SHAPE design system lives in two places, and each is authoritative for different things:

### Code → Mechanical Compliance (Components, Tokens, Implementation)

The admin design system pages in `src/components/admin/design-system/` are the authority for how components work — their props, states, exact token values, interaction patterns, and accessibility behavior. Code captures precision: the exact hex value, the exact pixel spacing, the exact transition timing. When you need to know "what border-radius does a card use?" or "what's the hover state for a ghost button?" — the answer is in the code.

### Figma → Taste & Creative Direction (Composition, Brand, Atmosphere)

The SHAPE Design System Figma file (`og2y5TjaBswiPpgovaiC59`) is the authority for how things should *feel*. The strategic context pages (1.1–1.5) capture the brand philosophy, creative brief, composition patterns, quietness spectrum, and approved visual language in ways that code can't. When you need to evaluate "does this page feel like SecondSight?" or "is the density right?" or "does the hierarchy guide the eye correctly?" — the answer is in Figma.

**Why this split exists:** Code is great at encoding precise, repeatable rules — "use this token, not that one." But taste is inherently visual and contextual. The Figma file contains curated examples, composition blueprints, the void ground rule, the quietness spectrum diagnosis framework, and the creative brief that defines what makes SecondSight feel like SecondSight vs. generic dark-theme design. Trying to capture all of that in TypeScript would dilute it.

## Layer 1: Mechanical Compliance (from Code)

### Before Writing ANY UI Code

Read the relevant component file first. Match your implementation to what you see there.

| If you're building... | Read FIRST |
|---|---|
| Buttons | `components/ComponentButtons.tsx` |
| Tables / data grids | `components/ComponentTables.tsx` |
| Tabs | `components/ComponentTabs.tsx` |
| Modals / dialogs / drawers | `components/ComponentModals.tsx` |
| Cards | `components/ComponentCards.tsx` |
| Forms / inputs | `components/ComponentForms.tsx` |
| Badges / status indicators | `components/ComponentBadges.tsx` |
| Alerts / notifications | `components/ComponentAlerts.tsx` |
| Avatars | `components/ComponentAvatars.tsx` |
| Empty states | `components/ComponentEmptyStates.tsx` |
| Search bars | `components/ComponentSearchBars.tsx` |
| Headers / nav bars | `components/ComponentHeader.tsx` |
| Sidebar navigation | `components/ComponentSidebar.tsx` |
| Pagination | `components/ComponentPagination.tsx` |
| Scrollbars | `components/ComponentScrollbars.tsx` |
| Kanban / boards | `components/ComponentBoards.tsx` |

All paths above are relative to `src/components/admin/design-system/`.

### Foundational Tokens & Rules (from Code)

| Topic | File |
|---|---|
| Philosophy & critical rules | `OverviewTab.tsx` |
| Colors & palette | `ColorSystemTab.tsx` |
| Typography & fonts | `TypographyTab.tsx` |
| Spacing & layout | `SpacingAndLayout.tsx` |
| Interactions (focus, hover) | `InteractionsTab.tsx` |
| Border radius | `BorderRadiusTab.tsx` |
| Glow & elevation (NO shadows) | `GlowAndElevation.tsx` |
| Cross-platform | `CrossPlatform.tsx` |
| Token browser | `TokenViewer.tsx` |
| Violation scanner | `GapAnalysisDashboard.tsx` |

### Use Design System Components

Always use production components from `src/design-system/` — never raw HTML or shadcn/ui:

`Button`, `Card`, `DataTable`, `DataTableHeader`, `DataTableRow`, `DataTableCell`, `ResponsiveTabs`, `Dialog`, `Alert`, `Input`, `StatusText`, `GhostToken`, `EmptyState`, `PageLayout`, `TabbedPage`, `Display`, `Headline`, `BodyText`, `Label`, `ActionToolbar`, `Divider`

Token definitions: `src/design-system/tokens.ts`

### Mechanical Severity Levels

- **S1 (Critical):** Using wrong components (shadcn instead of design system), shadows, hardcoded colors, container borders, wrong page layout
- **S2 (Important):** Badge overuse, unnecessary icons, wrong opacity, non-standard radius, wrong transitions
- **S3 (Advisory):** Missing overscroll-contain, suboptimal token choices, improvement opportunities

## Layer 2: Taste Audit (from Figma)

Mechanical compliance is necessary but not sufficient. Code can pass every token check and still feel wrong — too dense, too loud, hierarchy unclear, atmosphere off-brand. Taste evaluation requires grounding in the brand's creative identity, which lives in the Figma design system.

### When to Pull from Figma

Use the Figma Console MCP to read from the SHAPE Design System file (`og2y5TjaBswiPpgovaiC59`) when:

- **Evaluating page-level composition** — Is the void ground rule respected (60%+ dark space)? Does the page sit in the right zone on the quietness spectrum? Pull from Figma pages 1.2 (Design System Overview) and 1.3 (Taste & Composition) to calibrate.
- **Assessing brand atmosphere** — Does this feel like SecondSight, or just "a dark theme"? The creative brief on Figma page 1.5 defines the distinction: the cinematographic quality, the accent-as-signal philosophy, darkness as ground state.
- **Reviewing composition patterns** — Is the section hierarchy correct? Are hero treatments, density thresholds, and information groupings following the blueprints? Figma page 2.10 (Composition Patterns) has the structural recipes.
- **Checking new page designs** — When building an entirely new page or major feature, read the strategic context (pages 1.1–1.5) to internalize the brand before evaluating whether the implementation honors it.

### How to Pull from Figma

If the Figma Desktop Bridge is connected (check via `figma_get_status`), use these MCP tools:

- `figma_get_file_data` — Read page structure and content from the design system file
- `figma_get_variables` — Read design token variable collections for cross-referencing
- `figma_capture_screenshot` — Get visual reference for composition evaluation

If the Desktop Bridge is not connected, fall back to the code-side taste reference in `TasteComposition.tsx` — it's a reasonable approximation, but note that it's a subset of what Figma captures. Flag in your review that a full taste audit would benefit from the Figma connection.

### Taste Severity Levels

- **T1 (Composition Broken):** No clear attention hierarchy. Wrong component semantics (e.g., GhostTokens as buttons). Density exceeds thresholds. Page atmosphere contradicts SecondSight aesthetic. Action bars with 3+ undifferentiated buttons.
- **T2 (Density/Rhythm Violation):** Spacing inconsistency. Whitespace ratios inverted. Content-type density mismatch. Mixed indicator languages. Progressive disclosure exceeds 2 levels.
- **T3 (Suboptimal Atmosphere):** Mechanically correct but feels "off." Minor compositional improvements. Vertical rhythm slightly off.

### Figma Strategic Context Pages (for Taste Reference)

| Page | What It Contains | When to Reference |
|---|---|---|
| 1.1 Brand Manifesto | Brand philosophy, values, voice | When evaluating tone/personality of UI copy or interactions |
| 1.2 Design System Overview | Core principles, critical rules, forbidden patterns | When checking fundamental constraint compliance |
| 1.3 Taste & Composition | Void ground rule, density thresholds, quietness spectrum, diagnosis framework | When evaluating page-level composition and atmosphere |
| 1.4 Approved Hero Images | Curated visual assets with creative metadata | When reviewing pages that use imagery |
| 1.5 Creative Brief | Visual language, imagery direction, patterns, cinematography, color philosophy | When assessing whether the design captures the SecondSight identity |

## When to Activate

Every time you write or modify UI code, run both layers:

1. **Mechanical (Code):** Read the relevant admin design system component file(s). Match your implementation to what you see there. Use design system components from `src/design-system/`.
2. **Taste (Figma):** For new pages or significant UI changes, check composition against the Figma strategic context. For minor changes, evaluate whether the change preserves the existing page's atmosphere and hierarchy.

For existing code during refactors or bug fixes, scan touched files for violations and flag them across both layers.

## Reporting Format

```
MECHANICAL REVIEW (source: code):
- [S1] file:line: description → Fix. Reference: ComponentXxx.tsx
- [S2] file:line: description → Fix. Reference: ComponentXxx.tsx

TASTE REVIEW (source: Figma / TasteComposition.tsx):
- [T1] file:line: description → Fix. Reference: Figma page N.N / TasteComposition.tsx §N
- [T2] file:line: description → Fix. Reference: Figma page N.N / TasteComposition.tsx §N
```

Always cite which source informed the finding — admin design system file for mechanical issues, Figma page number for taste issues. When Figma wasn't available, cite `TasteComposition.tsx` with section number (§1-§8) as the fallback.

## Audit Output Rules

All audit reports go to `momentum/design-system/audits/`. Naming: `design-audit-{scope}-{YYYY-MM-DD}.md`.

## Philosophy Reminder

Components and tokens live in code. Brand and taste live in Figma. Neither alone is complete. A page that passes every mechanical check but ignores the creative brief is off-brand. A page that nails the atmosphere but uses the wrong components is broken. Both layers matter, and each has its own source of truth.
