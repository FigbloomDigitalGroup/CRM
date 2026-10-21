# Claude Design brief, fourth pass: Appearance page, and the top-bar identity block with organisation switcher

Paste into the **same Claude Design project**. Attach the two reference screenshots from the sister product (Figbloom HR "Appearance" page): `reference/appearance-reference-1.png` and `appearance-reference-2.png`. Use them for **structure and feel**, not to copy pixel for pixel. Everything from earlier passes stays.

## 0. Ground rules

- **Frozen:** the sign-in, sign-up and related auth pages. They are never affected by anyone's appearance settings (always the approved light brand look).
- **Defaults stay the Figbloom brand:** the default theme is **Forest** (sidebar `#203E2A`, accent green, **orange `#FF9400`** highlight) on a **White** page. Personalisation is optional and always reversible.
- Keep the design system, review bar, release tags and the "Show: V1 / + V1.1 / + V2" switch. Add rows to the Screen Checklist with new IDs (AP… and TB…) and a Linear column ("new").
- Applies to **every account**: Management, Sales, Delivery, Finance, Restricted Technical, Customer Support (proposed), and the **Platform Super Admin** (with the limits in section 4).

---

## Part 1. Appearance and preferences

### 1.1 Where it lives
A personal page, **Preferences**, reachable from the **user menu** (top right) and from the bottom of the sidebar, for **every role**, including those whose Settings page otherwise shows only notification preferences. Tabs:
1. **Profile** (picture, display name, phone, time zone, language V2)
2. **Notifications** (replaces today's standalone notification-preferences section; same content, one home)
3. **Appearance** (this brief)
4. **Security** (password, active sessions and sign-in history for me, two-factor V1.1)

The page says, as in the reference: *"This only changes your own settings, not anyone else's."* A **Reset to default** button sits top right. Changes apply **live** with an **Undo** toast. Nothing needs a Save button except the profile fields.

### 1.2 Appearance tab sections (adapt the reference)
| Section | Content | Release |
|---|---|---|
| **Profile picture** | Upload, crop, remove (falls back to initials). Shown in the user menu, owner chips, timelines, comments and @mentions. Mobile: camera or files. States: uploading, too large, wrong type, upload failed. | V1 |
| **Themes** | Cards pairing a sidebar colour with an accent: **Forest (default)**, Ocean, Midnight, Aubergine, Teal, Rosewood, Charcoal and amber, Mist, Sand, Sky. Selected card shows "Selected". Each card previews sidebar, page and accent dot. | V1 |
| **Page colours** | White (default), Cool grey, Warm sand, Mint, Sky, Lavender, Blush, **Dark, Navy night, Black**, plus **Match my device** (auto light or dark). This **subsumes the current top-bar light and dark toggle**: keep a one-tap toggle in the top bar that flips between the user's chosen light and dark pair. | V1 |
| **Your own colours** | Sidebar colour, accent colour, highlight dot, page colour, each with a colour picker and hex field, and a live mini-preview. Text switches between light and dark automatically for contrast, and buttons are darkened if needed. **Guardrail:** if a choice fails WCAG AA contrast, show a small warning and auto-adjust, never allow unreadable text. | V1.1 |
| **Density** | Comfortable (default) or Compact for tables, lists and the deals board. Shows a live example row. | V1 |
| **Text size** | Default, Large, Larger, Largest. Scales text, buttons and spacing together. Verify the layout at Largest, desktop and 375px. | V1 |
| **Accessibility** | Bolder text, Higher contrast, Reduce motion (also respects the system setting), Focus ring always visible. | V1 |
| **Start page** | Which page opens after sign-in: Today (default), Leads, Deals, Tasks, Calendar. Only pages the role can use are offered. | V1.1 |
| **Sidebar** | Start collapsed or expanded; choose whether group labels show. | V1.1 |
| **Date, time and numbers** | Time zone (defaults to the organisation's), 12 or 24 hour, first day of the week, date format. KES stays the currency. | V1.1 |

**What is stored where** (show this with a small note): theme, page colours, own colours, density, start page and profile picture are saved **to the account** and follow the user across devices. **Text size, bolder text, higher contrast and reduce motion are saved on this device only**, as in the reference.

### 1.3 Role matrix: who can customise what
| Capability | Management | Sales | Delivery | Finance | Restricted Technical | Customer Support | Platform Super Admin |
|---|---|---|---|---|---|---|---|
| Profile picture and name | Edit | Edit | Edit | Edit | Edit | Edit | Edit |
| Themes, page colours, own colours | Edit | Edit | Edit | Edit | Edit | Edit | **Limited** (see 4) |
| Density, text size, accessibility | Edit | Edit | Edit | Edit | Edit | Edit | Edit |
| Notification choices | Edit (all types) | Edit (own types) | Edit (own types) | Edit (own types) | Edit (own types) | Edit (own types) | Edit (platform alerts) |
| Start page | Edit | Edit | Edit | Edit | Edit (My work or Tasks only) | Edit | Edit |
| **Organisation default theme** for new members | Edit | No access | No access | No access | No access | No access | No access |
| **Allow members to personalise appearance** (on or off) | Edit | No access | No access | No access | No access | No access | No access |
| **Organisation logo and name** shown in the top bar | Edit | Read-only | Read-only | Read-only | Read-only | Read-only | No access |

The two organisation-level controls and the logo live under **Settings › Organisation profile** (Management only). If Management turns personalisation off, the Appearance tab shows the organisation default read-only with the line "Your organisation uses a shared look." White-labelling stays out of scope: only logo and name, no custom domains or full re-skinning.

### 1.4 Notifications tab (fold the existing settings into it)
Per event type, a channel choice (in-app, email, push once installed): lead assigned, task due, task overdue, @mention, handoff received, renewal due, proposal unanswered, stalled deal, support-access request (Management only). Per role, **only show the types that role can receive**. Plus **Everything, Important only, Off** presets, quiet hours, a daily email cap ("At most 20 emails a day, the rest arrive in your next email"), and a note that role-critical alerts for overdue work cannot be fully turned off for assignees.

### 1.5 Guardrails (apply to every role)
- **Status and meaning colours are fixed**: red for overdue and errors, amber for warnings and stalled, green for success, the scope pills (Own, Organisation, Read-only), the **masked-value** treatment, the **archived** banner, and the **support-access** banner. Themes cannot recolour them.
- Dark and high-contrast variants are generated from the chosen theme and checked.
- Charts keep their validated category colours regardless of theme.
- No theme hides required information or the role's scope indicators.

### 1.6 Screens and states
**AP1** Preferences shell with tabs; **AP2** Appearance (all sections above); **AP3** picture upload and crop; **AP4** own-colours picker with contrast warning; **AP5** shared-look read-only variant; **AP6** Notifications tab per role; **AP7** Security tab (my sessions, my sign-in history, change password; two-factor V1.1); **AP8** Reset-to-default confirmation. Mobile 375px for AP1 to AP3 and AP6. States: loading, saved, undo, upload failed, contrast warning, device-only note, Largest text overflow check.

---

## Part 2. Top bar: organisation logo, dashboard label, signed-in time, organisation switcher

### 2.1 What exists in the reference
The sister product shows the organisation logo with name and a dashboard label on the left, then on the right a "Logged in at 11:23:14 AM" clock, the bell, and the user avatar with name and the same "Logged in at" text. The time appears **twice** and crowds the right side.

### 2.2 What to design for the CRM
**One identity block on the left of the top bar:**
- **Organisation logo** (from Organisation profile; Figbloom mark as fallback) and **organisation name**.
- **Directly under the name, one small line**: the **dashboard or role label** and the **signed-in time**, for example *Management dashboard · Signed in 11:23 AM*. The signed-in time moves here **from the right cluster**; it must not appear anywhere else in the bar.
- A **chevron** appears only when the user belongs to more than one organisation (see 2.4). Clicking the block opens a **popover** (see 2.3).

**Right cluster, lighter than today:** global search, quick-create (+), notification bell, light or dark quick toggle, and the **avatar menu** showing **name and role only** (no time). Preferences, Sign out, and the organisation switcher entry are in that menu as well.

**Responsive:** at tablet width the line under the name truncates to *Signed in 11:23 AM*; at 375px the block collapses to the logo only, and the popover carries the detail. Keep the bar one line high.

**Labels per role:** Management dashboard, Sales workspace, Delivery workspace, Finance workspace, Technical workspace (My work), Support workspace (proposed). Match the first-pass role names.

### 2.3 Identity popover (all roles)
- Organisation name, logo, **your role in this organisation**, and how you are signed in.
- **Signed in:** full date and time in the user's time zone (for example Mon 19 Oct, 11:23:14 AM EAT), device and place ("Chrome, Nairobi") and **session length remaining** (matches the sign-in policy in Security: 4, 8, 12 or 24 hours).
- **Session about to expire:** a gentle bar five minutes before, with **Stay signed in** and **Sign out**. After expiry, the existing **Session expired** screen.
- Links: Preferences, My sessions, Sign out, **Sign out other devices**.
- If a **support view** is active (V2), a fixed notice appears here too.
- Time is a real `<time>` element for screen readers; it does not tick like a clock.

### 2.4 Organisation switcher (only where the user belongs to several organisations)
FIG-437 says switching is allowed only with an active membership and leaves it as an open V1 decision, so design it fully but tag it.

- **Single-organisation users (V1):** no chevron, no switcher, no empty state. They see only their organisation's identity block.
- **Multi-organisation users (V1.1):** the popover lists each organisation with logo, name, **the user's role there** (a person can be Management in one and Sales in another), last visited, and an unread count. Current organisation is ticked. Search appears above six organisations. A **Pending invitation** appears as "Accept". A **suspended** organisation is shown disabled with the reason.
- **Switching** reloads the workspace under that organisation's role: navigation, scope pills and values visibility change, a short toast confirms ("Now in Brookside Ltd as Sales"), and the app remembers the last organisation per device. Deep links carry the organisation, and opening a link for another organisation offers to switch.
- **Keyboard:** open with a shortcut, arrows and Enter. Add the organisations to the command palette.
- Review-bar aid: add **Organisations: One / Several** so reviewers can see both modes without a new login.
- **Platform Super Admin:** no organisation switcher. They use the Organisations list; inside a support view the identity block shows the organisation with the support banner.

### 2.5 Screens and states
**TB1** top bar, default per role (seven variants); **TB2** identity popover; **TB3** session-expiring prompt; **TB4** organisation switcher (several organisations, search, pending invite, suspended, switching toast); **TB5** top bar at tablet and 375px; **TB6** top bar inside a support view and inside the Platform console (no organisation logo, "Platform console" pill and environment label). States: no logo uploaded, long organisation name, slow switch, switch failed, time zone differs from the organisation's.

---

## Part 3. Deliverables

1. Prototype updated with Preferences (AP1 to AP8) for all roles, the new top bar and identity popover (TB1 to TB6), light and dark, desktop and mobile where stated, release tags and the review-bar toggle for one or several organisations.
2. Screen Checklist rows for AP and TB IDs with the role cells, states designed, release and Linear column.
3. Design-system additions: theme card, colour picker with contrast check, density sample, identity block, organisation row, session timer bar.
4. Open questions and assumptions, especially: which settings sync to the account versus the device, whether Management may lock personalisation, and the V1 versus V1.1 line for organisation switching.
