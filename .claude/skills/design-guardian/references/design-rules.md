# Design System — Rules Reference

## SOURCE OF TRUTH

**Do not use this file as a design reference.** The source of truth is the admin design system — working code with live examples at:

```
src/components/admin/design-system/
```

### Component Reference (read the actual file)

| Component Type | Reference File |
|---|---|
| Buttons | `components/ComponentButtons.tsx` |
| Tables | `components/ComponentTables.tsx` |
| Tabs | `components/ComponentTabs.tsx` |
| Modals / Dialogs | `components/ComponentModals.tsx` |
| Cards | `components/ComponentCards.tsx` |
| Forms / Inputs | `components/ComponentForms.tsx` |
| Badges / Status | `components/ComponentBadges.tsx` |
| Alerts | `components/ComponentAlerts.tsx` |
| Avatars | `components/ComponentAvatars.tsx` |
| Empty States | `components/ComponentEmptyStates.tsx` |
| Search Bars | `components/ComponentSearchBars.tsx` |
| Headers | `components/ComponentHeader.tsx` |
| Sidebar | `components/ComponentSidebar.tsx` |
| Pagination | `components/ComponentPagination.tsx` |
| Scrollbars | `components/ComponentScrollbars.tsx` |
| Boards / Kanban | `components/ComponentBoards.tsx` |

All paths relative to `src/components/admin/design-system/`.

### Foundational Reference (read the actual file)

| Topic | File |
|---|---|
| Philosophy & rules | `OverviewTab.tsx` |
| Colors | `ColorSystemTab.tsx` |
| Typography | `TypographyTab.tsx` |
| Spacing & layout | `SpacingAndLayout.tsx` |
| Interactions | `InteractionsTab.tsx` |
| Border radius | `BorderRadiusTab.tsx` |
| Glow & elevation | `GlowAndElevation.tsx` |
| Cross-platform | `CrossPlatform.tsx` |
| Token browser | `TokenViewer.tsx` |
| Gap analysis | `GapAnalysisDashboard.tsx` |
| Taste & composition | `TasteComposition.tsx` |

### Production Components (use these, not shadcn/ui)

All in `src/design-system/`:

`Button`, `Card`, `DataTable`, `DataTableHeader`, `DataTableRow`, `DataTableCell`, `ResponsiveTabs`, `Dialog`, `Alert`, `Input`, `StatusText`, `GhostToken`, `EmptyState`, `PageLayout`, `TabbedPage`, `Display`, `Headline`, `BodyText`, `Label`, `ActionToolbar`, `Divider`

Token definitions: `src/design-system/tokens.ts`

### Tessera-Specific

- Token source: `src/styles/theme.css`
- Interactions: `src/styles/interactions.css`
- SCSS Mixins: `src/styles/_momentum-tokens.scss`
- Enforcement: `npm run lint:styles` (Stylelint)
