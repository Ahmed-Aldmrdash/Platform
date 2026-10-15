# El Sewedy Identity Spec — HSE Platform

Phase 2 of the redesign: the visual identity the platform will follow. Status: **proposal, awaiting
approval**. Nothing in the app uses these values yet; Phase 3 turns them into the token file.

A visual preview of everything below (light and dark) is in
[`identity-preview.html`](identity-preview.html) — open it in a browser.

## 1. What the group sites actually use

Fetched on 2026-10-15 (HTML and every linked stylesheet, colors counted across ~3 MB of CSS).

| Source | Brand color | Neutrals | Type | Shape | Notes |
| --- | --- | --- | --- | --- | --- |
| elsewedy.net/ar (group) | **`#B82328`** (`theme-color`, 54 uses) | `#FFFFFF` dominant (177 uses), text `#000` / `#050606` / `#111`, grays `#333` `#444` `#676767` `#999` `#DDD` `#EEE` | **Alexandria** (Arabic + Latin), Raleway / Roboto for English headings | radius 0–4 px; shadow `1px 6px 20px rgba(17,17,17,.1)` | Red only marks: active menu item (red text + red underline bar), primary buttons (square, red, hover → black), input focus border, current page number, section title bars. Header and page are white; logo in the header at the start side. |
| sta.edu.eg (STA) | `#88192C` (deep maroon) | white, `#1A1B1F`, `#32343A` | Cairo | 15–40 px (Webflow, soft) | Same white-first approach, darker red. |
| sut.edu.eg (SUT) | none (red is not used as a UI color) | white, `#333`, `#666`, `#EBECED`, `#F8F8F8` | Montserrat + Tajawal | 4 px | Blue accents (`#398FFC`) for links. |
| ir.elsewedyelectric.com (2 pages) | — | — | — | — | **Not reachable**: the site's TLS certificate has expired, so it was not read (the check was not bypassed). Send values from it if they matter. |
| Our own logo (`icons/elsewedy-logo.png`) | `#D01C24`–`#D42028` (sampled) | — | — | — | Matches the `#D51E27` already in `manifest.json`. The app's current CSS red `#E2001A` matches neither. |

**Take-aways.** The group is white-first with red as a sparing accent, near-black text, light gray
lines, small radii and almost no shadow; one Arabic/Latin family (Alexandria). We adapt rather
than copy: an operational system needs status colors, denser tables and clear focus states that a
marketing site does not.

## 2. Principles

1. **White carries the interface.** Page, header, sidebar, cards, tables and modals are white or
   near-white (≈ 85–90 % of any screen).
2. **Red means "El Sewedy" or "act here"** — logo, active navigation, the one primary button of a
   section, key highlights. It never fills a page header, a section band or a whole card
   (≈ 3–6 % of a screen).
3. **Status colors are tints, not fills.** Risk and status read through soft backgrounds with
   strong text, so a list of 50 records doesn't turn into a wall of red.
4. **Danger is a style, not just a color** (section 7).
5. **Charcoal text, light gray structure.** Lines are quiet; information is loud.

## 3. Palette — light theme

### Brand

| Token | Hex | Use |
| --- | --- | --- |
| `--brand-600` | `#D51E27` | Logo red. Primary buttons, active nav marker, focus ring, key figure accents, chart series 1. White text on it: 5.19:1 ✓ |
| `--brand-700` | `#B82328` | Group red. Primary hover/pressed, red text and links on white (6.35:1 ✓), active nav text |
| `--brand-800` | `#8F1B20` | Pressed state, red on light tints in dark contexts |
| `--brand-50` | `#FFF5F5` | Active nav background, selected row, primary-tinted callouts |
| `--brand-100` | `#FBE3E4` | Brand badges, chart fills |

### Neutrals (≈ 90 % of the UI)

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#F5F6F7` | Page background behind white cards (keeps structure visible) |
| `--surface` | `#FFFFFF` | Header, sidebar, cards, tables, modals, inputs, login |
| `--surface-2` | `#FAFAFB` | Table header row, zebra stripes, filter bar, card footer |
| `--surface-3` | `#F0F1F3` | Hover row, segmented controls, disabled fields |
| `--border` | `#E4E5E7` | Card and table lines, dividers |
| `--border-strong` | `#D2D4D8` | Section separators, table outer border |
| `--input-border` | `#8B909A` | Field outlines (3.20:1 against white — meets WCAG 1.4.11) |

### Text

| Token | Hex | Use |
| --- | --- | --- |
| `--text` | `#1E1F22` | Body and headings (16.48:1) |
| `--text-2` | `#4A4D55` | Secondary text, table cells of lesser weight (8.45:1) |
| `--text-muted` | `#6B6F78` | Captions, timestamps, placeholders (5.04:1 on white, 4.65:1 on `--bg`, 4.83:1 on `--surface-2`). Not on `--surface-3` (4.46:1) — use `--text-2` there |
| `--text-on-brand` | `#FFFFFF` | Text on brand / semantic fills |

### Semantic

| Role | Solid (buttons, icons) | Text | Tint (badges, callouts) | Notes |
| --- | --- | --- | --- | --- |
| Success | `#15803D` (white 5.02:1) | `#067647` | `#ECFDF3` | Approve, confirm, close permit, done |
| Warning | `#F59E0B` with charcoal text (7.67:1) | `#B54708` | `#FFFAEB` | Suspend, flag, request changes, pending |
| Info | `#175CD3` (white 5.99:1) | `#175CD3` | `#EFF8FF` | View, preview, print, in progress |
| Danger | `#B42318` (white 6.57:1) — only inside confirmation dialogs | `#B42318` | `#FEF3F2` | Delete, reject, revoke, errors |

### Risk (identical in every module)

| Level | Badge | Label |
| --- | --- | --- |
| Critical | text `#7A271A` on `#FEE4E2`, 1 px `#FDA29B` border | حرجة |
| High (H) | text `#B42318` on `#FEF3F2` (6.05:1) | عالية |
| Medium (M) | text `#B54708` on `#FFFAEB` (5.20:1) | متوسطة |
| Low (L) | text `#067647` on `#ECFDF3` (5.40:1) | منخفضة |

Every risk badge carries a small dot or icon as well as color, and the Arabic label everywhere
(no "High 🔴").

### Status (permits, hazards, trainings, drills)

| Meaning | Style |
| --- | --- |
| Awaiting action (pending, open) | Warning tint |
| In progress (routed, under repair, running) | Info tint |
| Approved / done | Success tint |
| Closed / archived | Neutral: `#4A4D55` on `#F0F1F3` |
| Rejected | Danger tint |
| Overdue | Danger text + clock icon, added next to the status badge |

### Charts

Series order: `#D51E27` (brand) → `#3B3F46` (charcoal) → `#8B909A` (gray) → `#F59E0B` (amber) →
`#175CD3` (blue) → `#12B76A` (green) → `#7A5AF8` (violet). Gridlines `#E4E5E7`, axis text
`--text-muted`. Red is the lead series; it is not used for every series, so charts stay readable.

### Focus

`--focus-ring: 0 0 0 3px rgba(213, 30, 39, .30)` plus a 1 px `--brand-600` outline on fields.

## 4. Palette — dark theme

| Token | Hex |
| --- | --- |
| `--bg` | `#0F1012` |
| `--surface` | `#17181B` |
| `--surface-2` | `#1F2024` |
| `--surface-3` | `#26282D` |
| `--border` | `#2E3036` |
| `--input-border` | `#6E737C` (3.72:1 on surface) |
| `--text` | `#ECEDEF` (15.15:1) |
| `--text-muted` | `#A3A7AE` (7.35:1) |
| Brand fill | `#D51E27` (white text 5.19:1) |
| Brand text / links | `#F0686C` (5.83:1) |
| Success / warning / info / danger text | `#4ADE80` / `#FBBF24` / `#60A5FA` / `#F97066` |
| Tints | the light tints at 12–16 % opacity over `--surface` |

## 5. Typography

- **Family:** `"Alexandria", "Cairo", system-ui, sans-serif` — Alexandria is the group's
  Arabic + Latin face; Cairo stays as the fallback already cached by users. Oswald is dropped.
- **Weights:** 400 body, 500 labels, 600 headings and buttons, 700 key figures.
- **Scale (px):** 12 caption · 13 table / secondary · 14 body · 16 lead / section title ·
  18 card title · 22 page title · 28 key figure. Line height 1.6 for Arabic body, 1.3 for headings.
- **Numbers:** `font-variant-numeric: tabular-nums` in tables, IDs and KPIs; IDs, codes and emails
  wrapped in `<bdi>` so they don't break the sentence direction.
- **Language:** all UI copy in Arabic (English UI via the existing toggle). No uppercase English
  labels ("SEND MAIL" → "إرسال").

## 6. Shape, spacing and elevation

- **Radius:** `--r-sm 4px` (badges, small controls) · `--r-md 6px` (buttons, inputs, chips) ·
  `--r-lg 10px` (cards, modals) · `--r-pill 999px` (status badges only). Closer to the group's
  crisp 0–4 px while staying friendly on touch screens.
- **Spacing:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40.
- **Elevation:** `--shadow-1 0 1px 2px rgba(16,24,40,.06)` (cards) ·
  `--shadow-2 0 4px 12px rgba(16,24,40,.08)` (dropdowns, sticky headers) ·
  `--shadow-3 0 16px 40px rgba(16,24,40,.18)` (modals). Borders do most of the work.
- **Layers:** base 0 · sticky 10 · dropdown 100 · overlay/modal 1000 · toast 1100.

## 7. Brand red vs. danger red — the decision

Brand red (`#D51E27`) and danger red (`#B42318`) are both red; hue alone cannot separate them
(and does not work at all for color-blind users). So danger is separated by **style, icon,
position and friction**, not by a slightly different red:

| | Primary (brand) | Danger |
| --- | --- | --- |
| Fill | Solid `#D51E27`, white text | **Outline**: white background, 1 px `#B42318` border, `#B42318` text |
| Icon | Action icon (save, plus, send) | Always trash / ✕ / ban icon |
| Position | Inline-start of the action group (right in RTL), one per section | Inline-end, separated from the primary group; bulk "delete all" moves to a "More ⋯" menu / "Danger zone" at the bottom of the page |
| Friction | None | Always a confirmation dialog naming the item and the consequence; "delete all" asks the user to type a word to confirm |
| Filled red | — | Only the final button inside the confirmation dialog |

Why: users learn "filled red = go", which is right for the brand; an outlined red button with a
trash icon reads as "careful" everywhere, and the confirmation catches the rest. Workflow
decisions that aren't deletion (Reject a report, Revoke access) use the same danger-outline style
plus a required reason.

## 8. Layout and navigation

- **Header (white, 64 px):** logo at the inline-start (right in RTL) with the product name in
  Arabic «منصة السلامة والصحة المهنية» beside it; search / language / theme / notifications / user
  menu at the inline-end. 1 px `--border` bottom line, no shadow.
- **Sidebar (white, 248 px):** items in `--text-2`; the active item gets `--brand-50` background,
  `--brand-700` text and a 3 px `--brand-600` bar on the inline-start edge — the group site's
  "red underline" adapted to a vertical menu. Counts as small neutral badges, overdue counts in
  danger tint.
- **Phones (< 768 px):** sidebar becomes a drawer behind a menu button; the 4 most-used screens
  sit in a bottom bar; header shrinks to 56 px.
- **Page header (every screen):** title (22 px) + one-line description, the primary action and
  secondary actions on the same line; no colored bands.
- **Filter bar:** one white row (search, selects, date range) + a row of active filter chips;
  status chips become a segmented control.

## 9. Applying the identity

- **Login:** white page (`--bg`), white card, logo on top, one red primary button. The dark red
  gradient and floating emoji are removed. Worker and admin logins share the same card.
- **Cards, tables, forms, modals, toasts:** white surfaces, `--border` lines, `--r-lg` cards,
  `--r-md` controls. Toasts: white with a 4 px colored edge by type.
- **Print / PDF:** white page, charcoal text, logo plus a thin `--brand-600` rule under the
  header, table headers in `--surface-2` with `--border` lines.
- **Logo in dark mode:** `elsewedy-logo.png` has a white background, so in dark mode it sits on a
  white tile (`--r-sm`, 4 px padding) instead of being recolored.
- **PWA:** `theme-color` `#FFFFFF` (with `#0F1012` for `prefers-color-scheme: dark`); manifest
  `theme_color` and `background_color` `#FFFFFF`. The app icon keeps the red logo.

## 10. Contrast record

All pairs above were computed from the hex values: body text 16.48:1, secondary 8.45:1, muted
5.04:1, white on brand 5.19:1, white on danger 6.57:1, white on success 5.02:1, charcoal on
warning 7.67:1, white on info 5.99:1, all risk badges ≥ 5.20:1, field borders 3.20:1 (light) and
3.72:1 (dark). Two current colors that fail and are replaced: white on `#16A34A` (3.30:1) and
white on `#D97706` (3.19:1).
