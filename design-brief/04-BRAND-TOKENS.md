# Figbloom CRM: brand and design tokens (as they exist today)

Extracted from `src/app/globals.css` (`:root` and `:root[data-theme="dark"]`) and `src/app/layout.tsx`. These are the **starting point to emulate and improve**, not a spec to copy exactly.

## Colour

| Token | Value | Used for |
|---|---|---|
| `--brand-green` | `#1f5c3a` | Primary actions, links, success, accent |
| `--brand-green-dark` | `#143d26` | Hover and pressed states |
| `--brand-green-soft` | `#e7f0ea` | Tinted backgrounds, success chips |
| `--brand-orange` | `#ff9400` | Secondary accent, highlights, manage-area icons |
| `--brand-orange-dark` | `#cc7600` | Orange hover |
| `--sidebar-bg` | `#1c3f2a` | Sidebar (deep green) |
| `--sidebar-bg-raised` | `#284935` | Sidebar raised surfaces |
| `--sidebar-border` / `--sidebar-field-bg` | `#335240` | Sidebar dividers and search field |
| `--sidebar-text` / `--sidebar-text-muted` | `#e3ebe6` / `#8fab9b` | Sidebar text |
| `--sidebar-active-bg` / `-text` | `#ffffff` / `#1c3f2a` | Active nav item (inverted pill) |
| `--sidebar-icon-workspace` | `#55c26b` | Workspace nav icons |
| `--bg-page` | `#f4f3ef` | Page background (warm off-white) |
| `--bg-card` | `#ffffff` | Cards |
| `--border` / `--border-strong` | `#e6e3da` / `#d6d2c5` | Hairlines |
| `--text-primary` / `-secondary` / `-tertiary` | `#17181a` / `#62655d` / `#96988e` | Text |
| `--danger` / `--danger-bg` | `#cc3f3f` / `#fbeced` | Errors, overdue, destructive |
| `--warning` / `--warning-bg` | `#d9860e` / `#fdf3e2` | Warnings, stalled |
| `--success` / `--success-bg` | `#1f5c3a` / `#e7f0ea` | Success |
| `--info` / `--info-bg` | `#2f6fb0` / `#e9f1fa` | Info |

Dark theme (`data-theme="dark"`): page `#17181a`, card `#202226`, border `#2d2f34` / `#3a3d43`, text `#eef0ee` / `#a7aaa4` / `#797d78`. The sidebar colours stay the same in both themes.

**Logo.** A ring split into dark green and orange, with the wordmark "Figbloom" and the sub-line "DIGITAL GROUP". The logo artwork measures about `#2D5524` and `#FF9900`, which differ slightly from the CSS brand tokens (`#1f5c3a` and `#ff9400`). **Decision for Given:** pick one pair as canonical and let Claude Design reconcile the two.

## Type, shape, elevation

| Property | Today |
|---|---|
| Font | Instrument Sans (Google Fonts, `--font-brand`), with system-sans fallbacks. Mono: system monospace stack. |
| Radii | `6px` small, `10px` default, `16px` large |
| Card shadow | `0 1px 2px rgba(20,20,15,.04), 0 6px 16px rgba(20,20,15,.03)` |
| Sidebar width | `274px`, collapsible |
| Theme | Light and dark, toggle in the top bar |

## Existing UI vocabulary (so the redesign maps cleanly onto the code)

Sidebar (sections: Overview, Sales Workspace, Customers, Settings), top bar (global search, notification bell, theme toggle), `page-head`, KPI cards (`stat-card`, `kpi-card`), `table-card` / `data-table`, filter bar with search, scope pill and scope notice (own-records vs organisation-wide), owner chip, row menu, right-hand drawer for edit and create, searchable `Combobox`, lead tabs, Kanban board (deals), badges (red, orange, green, blue), timelines (activity, communication, audit), charts (bar, donut), `NoAccess` screen.

## Direction for the makeover (what "better and more modern" should mean)

- Keep the **deep green + orange** identity and the warm neutral page. Do not drift to a generic blue SaaS look.
- Give green a fuller ramp (50 to 900) and orange a restrained role: the main action stays green, and orange marks "attention / next action / highlight" only.
- More air and clearer hierarchy: larger page titles, a calmer table density option, consistent 4/8-point spacing.
- Replace the flat `Overview` placeholders with purposeful, role-aware home screens (see the brief).
- Mobile is a first-class target, not a squeeze of desktop (see the brief).
- Status colours must always pair with an icon or label, never colour alone.
- Check contrast (WCAG AA) for both themes.
