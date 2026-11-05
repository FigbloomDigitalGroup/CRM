# Command palette index, Help and What's new (FIG-1149, B6.17, design X3)

V1.1. Code: `src/lib/commandIndex.ts` (the commands, pure), `src/lib/helpContent.ts` (articles, tips, release notes), `src/services/helpService.ts`.
No database table: the content is written in code, reviewed with the rest of the wording, and carries no record, value or person.
The screens (`src/ui/screens/palette/`) are wired (5 Nov 2026): the palette reads `/commands` and `/search`, the Help panel and Help centre read `/help`, `/help/{slug}` and `/whats-new`. Where the API answers FEATURE_UNAVAILABLE (organisation not on V1.1) the palette falls back to the same permission rules held in `items.ts` and the Help panel to the written copy in `helpContent.ts`.

## Routes (outside the frozen V1 contract; all GET, all need release V1.1)

| Route | What |
|---|---|
| `/api/orgs/{org}/commands` | `{commands, search, shortcuts}`: the pages the caller may go to and the actions they may start, the record kinds search may return (`search.types`, minimum query 2 characters, endpoint `/search`), and the shortcuts of the commands they have |
| `/api/orgs/{org}/help?q=&area=&page=` | The Help article index for the caller; `page` also returns that page's tips |
| `/api/orgs/{org}/help/{slug}` | One article; an article written for a role the caller does not hold answers 404 (same as a missing one) |
| `/api/orgs/{org}/whats-new?since=YYYY-MM-DD&limit=` | Release notes for the organisation's release and for features the caller's role can use, newest first |

## Rules

- **Commands only list what the role may do.** Each command carries the permission keys the same page or route checks (the keys match `src/ui/screens/palette/items.ts` and the sidebar; `tests/commandPaletteAndHelp.test.ts` compares them role by role). A command that opens nothing the role can use is absent, not greyed out. Hiding is a courtesy; every route still checks its own permission.
- **Release and switches.** Go to Forecast needs release V1.1. Ask Figbloom needs `ai.use`, release V1.1 and the organisation's `assistant.enabled` switch (off by default), so a role without the assistant is not offered it.
- **Help.** An article with `requiresAny` is offered only to a role holding one of the keys, so Help never describes a screen the person cannot open. `minRelease` holds back articles for features the organisation does not have yet.
- **What's new.** A note shows when its release is not later than the organisation's release (V1 notes in V1.1, V2 notes only on V2) and, where it names keys, the caller holds one.

## Tests

`tests/commandPaletteAndHelp.test.ts`: the pure index, parity with the screen's list for all six roles, per-role expectations, the assistant switch per organisation, release gate, article visibility and 404, search and tips, the feed by role, date, limit and release, and that none of it carries an id, record or value.
