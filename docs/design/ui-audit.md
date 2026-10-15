# UI / UX audit — HSE Platform

Phase 1 of the redesign. No code was changed for this audit.

**Method.** Every frontend source file was scanned (22 CSS files / 6,507 lines, 36 JS modules /
12,781 lines, `index.html` / 2,564 lines) for colors, inline styles, buttons, typography, radii,
shadows and direction-dependent CSS. Every screen was then opened on a local copy of the real
data and checked at 1366×800 (desktop) and 390×844 (phone), in light and dark mode. Contrast
figures are WCAG 2.1 ratios computed from the actual colors.

## Numbers behind the findings

| Measure | Today | Enterprise target |
| --- | --- | --- |
| Distinct hex colors | 127 | ~25 tokens |
| Hard-coded colors (hex + `rgb()`) | 559 hex + 283 `rgb()` (180 hex inside JS) | 0 outside the token file |
| Inline `style="…"` (HTML + JS templates) | 718, plus 200 `element.style.x =` | layout-only exceptions |
| Buttons | 236, in 61 different class combinations, 101 with inline styles | 8 variants × 3 sizes |
| Parallel button families | `.btn-*`, `submit-btn`, `um-btn`, `act-btn`, `export-btn`, `logout-btn`, `btn-cyan/amber/emerald`, `emp-dir-btn`, `wl-*`, `cb-*` … | one (`.btn`) |
| Font sizes | 64 distinct values (10–30 px, mixed px / rem / clamp) | 7-step scale |
| Font families | Cairo + Oswald (Latin headings) | one brand family |
| Border radii | 23 distinct values | 4 tokens |
| `box-shadow` declarations | 71 | 3 elevation tokens |
| `z-index` values | 16 different, `9999` used 11 times, also `99999` / `10000` | 5 layers |
| Icon buttons using emoji | 123 | consistent SVG icon set |
| Physical direction CSS (`left/right`) vs logical | 60 vs 47 | logical only |
| Visible buttons under 44 px tall on a phone (dashboard) | 15 of 15 | 0 |

## Top 10 problems by impact

1. **The brand is inverted: red and black dominate, white is secondary.** The worker login is a
   dark red/black gradient, the dashboard hero is a black→red gradient with dark glass stat cards,
   section headers are solid red or black bands, and primary actions are full-width red bars. The
   red in use (`#E2001A`) is neither the logo red (`#D01C24`–`#D42028`, sampled from
   `icons/elsewedy-logo.png`; the manifest already uses `#D51E27`) nor the group red
   (`#B82328`, elsewedy.net).

2. **Destructive actions look like primary actions.** "Delete all permits / hazards / trainings /
   drills / penalties" are filled red, placed next to Create/Export, on six pages. In a hazard
   card "Reject report" is the same filled red as "Route to maintenance" and "Start repair", and
   "Delete" is a full-width red bar. In the users and employees tables "Edit" and "Delete" share
   the same red-outline style.

3. **No single button system.** A partial `.btn` system exists (`design-system.css`, ~40 buttons)
   beside eight legacy families. The same action looks different per page (four export styles:
   pink outline, dark, green, red). The filled green success button fails AA (white on
   `#16A34A` = 3.30:1), and so does white on the amber `#D97706` (3.19:1).

4. **Phones: the menu sits on top of the content.** On a 390×844 phone the header is ~450 px tall
   and the 12-item menu is stacked above the page, so content starts at y≈782: the user sees only
   navigation when a screen opens. On the permits page six rows of filter chips plus four
   full-width buttons (including "Delete all") come before the first record. The chat button
   floats over content and over card actions.

5. **Records are tall cards, not scannable data.** One permit card is ~400 px tall on desktop
   (a full-width green "Save code" button, description box, checklist line, actions); with 7,997
   permits that is endless scrolling. Status, risk, department and date are not aligned in
   columns, so they can't be compared at a glance. Only 5 sticky elements exist; no table has a
   sticky header.

6. **Every page frames itself differently.** Red band (Lectures, Drills), black band (Penalties,
   Backups, Reports sections), navy→burgundy gradient (Monthly inspection), plain title with emoji
   (Permits, Hazards, Employees). There is no shared page header (title, description, primary
   action, secondary actions).

7. **Colors are not controlled from one place.** Tokens exist but are misnamed (`--amber` holds
   the brand red, `--info` is dark gray) and are bypassed by 842 hard-coded colors and 718 inline
   styles (`drills/drills.js` alone has 124). Any identity change today means editing hundreds of
   places.

8. **Dark mode is unreliable.** Built from 60 hand-written overrides rather than tokens. On the
   hazards page in dark mode the filter card stays white (its title becomes invisible), "Clear
   filters" renders as a black box with invisible text, and "Upload Excel" is light gray on gray.

9. **Typography and language mix.** 64 font sizes; Oswald for Latin headings (not a group font);
   English or developer labels inside the Arabic UI: "SEND MAIL", "DEPT ADMIN / MAINT_ADMIN"
   badges, "Login (empCode)", "High 🔴 / Medium 🟡 / Low 🟢" on hazards while permits say
   "خطورة عالية". Emoji as icons render differently on Windows / Android / iOS and read as
   informal in a board presentation.

10. **Filters and actions are tangled.** Type chips, status chips, year chips, a department
    input, an advanced filter box and action buttons share the same rows with no grouping. Form
    inputs are beige in some forms and white in others; labels switch between bold-black and
    small-gray within one form (Lectures, Drills).

## Inconsistencies by component

**Buttons.** Eight families (see table above). Same action, different look: Export = pink
outline (permits), dark (penalties import), green (penalties export); Delete = filled red
(toolbars), red outline (tables), pink (permit card), full-width red bar (hazard card). Heights
range from ~28 px to ~56 px. Some are `<div onclick>` (34 clickable non-buttons), which keyboard
users can't reach.

**Colors.** 18 different reds (`#E2001A`, `#DC2626`, `#B91C1C`, `#EF4444`, `#C81E3A`, `#DC3545`,
`#FF6B6B`, `#A6000F`, `#8A0E1F`, `#7C1D1D` …); success/warning/info each in 3–5 shades. Risk
colors are solid fills in hazards (orange "Medium" pill) but outline tints elsewhere.

**Spacing.** No scale: `padding` appears in 133 different values; card padding differs per module;
section gaps jump between 8, 12, 16, 18, 24 px.

**Tables.** 12 tables built in JS with black header rows, no sticky header, row actions stacked
vertically (two buttons per row cell), numbers not tabular.

**Filters.** Chips are pills (`999px`) while inputs are 8–12 px radius; the active chip is solid
red (competes with primary buttons); the "Overdue" chip adds a second red variant.

**Forms.** Beige inputs (Lectures, Drills, permit card) vs white (search, login); required stars
in red; placeholders in Arabic with English examples ("EMP001").

**Modals.** At least four patterns: `um-modal-overlay` cards, full-screen overlays
(`force-pw-overlay`, profile), the native browser `confirm()` (20 calls, including deleting users
and restoring a backup), and the lightbox. Button order and colors differ between them.

**Badges.** Hazard status (`hz-status-badge`), permit status (`stamp`, `badge-approved`), user
roles (uppercase English), risk (English + emoji vs Arabic) — four badge systems.

**Empty / loading states.** Emoji + sentence ("✅ no penalties"), plain "جارِ التحميل…" text; no
skeletons, so lists jump when data arrives.

**Login.** Two unrelated designs: worker = dark glass card on a red/black gradient with floating
emoji PPE; admin = white card with a hazard-tape top border and beige inputs.

## Mobile and RTL issues

- Navigation is a vertical list above the content instead of a drawer or bottom bar.
- Header wraps "HSE / Platform" onto two lines and takes ~450 px.
- Touch targets: every visible button on the phone dashboard is under 44 px.
- Filter chip rows wrap into 5–6 rows; actions become full-width stacked bars.
- The floating chat button overlaps the last card's actions and the "Delete" button.
- 60 physical `left/right` rules (e.g. `text-align:left` for card actions, `border-right` accents)
  that should be logical (`inline-start/end`) so the layout mirrors cleanly.
- Mixed-direction strings (IDs, emails, dates in Arabic sentences) without `dir="auto"`/`<bdi>`,
  so punctuation jumps (e.g. "qa@example.test — …" lines on cards).
- The sidebar highlight animates out slowly, so two items look active for a moment.

## What it takes to look enterprise-grade

1. White-dominant identity with red as a sparing accent (Phase 2 spec).
2. One token file for color, type, spacing, radius, elevation and dark mode; no hard-coded colors.
3. One button system driven by the action, with destructive actions visually separated.
4. Data-dense, sortable-looking tables with sticky headers for permits, hazards, employees and
   penalties (cards only on phones), aligned columns and tabular numbers.
5. A shared page header and a shared filter bar (search + selects + an "active filters" row), with
   actions grouped on the inline-end side.
6. A consistent SVG icon set (one icon per action) instead of emoji.
7. One modal component (with a proper confirmation dialog for destructive actions), one badge
   system for status and risk, skeleton loading and designed empty states.
8. A real mobile navigation (drawer or bottom tab bar), 44 px targets, and compact cards.
9. Arabic-first copy everywhere (no developer labels), one Arabic/Latin font family.
10. Dark mode derived from the same tokens, checked to WCAG AA.
