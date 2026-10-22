# design-spec: the approved Figbloom CRM Final Design

**Read-only reference. This is not shipped code.** It is the clickable prototype Michael approved (92 screens: 54 V1, 29 V1.1, 9 V2). Build against it; never import from it, never edit it. If the design changes, replace the whole folder from a new Claude Design export and record the change in `docs/DECISIONS.md`.

The frozen pages (sign in, sign up, forgot and reset password, accept invite) appear in the prototype as A1 to A3 for completeness. They are **never** changed in the app (CLAUDE.md rule 1); a visual guard enforces it.

## What is here

| File | What it is |
|---|---|
| `Figbloom CRM.dc.html` | The prototype shell. Open this one. |
| `Crm*.dc.html` | The prototype's screens, one file per area (Leads, Deals, Customers, Tasks, Reports, Platform console, Mobile, and so on). Loaded by the shell. |
| `Figbloom Screen Checklist.dc.html` | The 92-row Screen Checklist: screen ID, who sees it, states designed, release. Source of `TRACEABILITY.md`. |
| `Figbloom Design System.dc.html` | Tokens, components and states. Source for the F1.x design-system issues. |
| `crm-store.js` | The prototype's sample data (companies, contacts, leads, deals, tasks, payments, templates). Source for seed v2 (B0.08). |
| `crm-theme.css`, `icons.js`, `support.js` | Prototype styling, icon set and runtime. |
| `assets/` | Logo and the two frozen auth panels. |
| `_ds/` | Design-system export bundled with the prototype. |
| `TRACEABILITY.md` | One row per checklist ID: release, backend issue, frontend issue, status. |

## Run the prototype locally

The prototype loads its other files by relative path, so open it through a local web server, not by double-clicking the file:

```
npx serve design-spec
```

Then open the address it prints and choose `Figbloom CRM.dc.html`. (`python -m http.server --directory design-spec 8080` works too.) It needs internet for the web fonts only.

## How to use the review bar

The bar at the top of the prototype switches what you are looking at:

- **Account**: Management, Sales, Sales Two, Delivery, Finance, Restricted Technical, Customer Support (proposed) and the platform console identity. Each role sees only its own navigation, masked values and "no access" pages.
- **Device**: desktop or phone. The phone layouts are the mobile screens (F4.10, F4.11).
- **Theme**: light, dark and the colour options.
- **State**: loading, empty, no results, error, offline and similar. Every screen's designed states are listed in the checklist's "States designed" column.

## Rules

1. Reference IDs (A1, L2, P1, S5#2 ...) come from the Screen Checklist and appear in each Linear issue's "Design reference" line.
2. The checklist repeats S5 to S8 for two different sets of screens. In the map they are `S5`, `S5#2`, and so on. Ask Claude Design to renumber on the next revision.
3. When a screen lands, update its Status in `TRACEABILITY.md` in the same pull request.
4. Where the prototype and `docs/DECISIONS.md` disagree, `docs/DECISIONS.md` wins (it records what Given and Michael signed).
