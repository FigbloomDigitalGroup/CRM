# Backend V1 demo run (G1.08, FIG-1075)

Produced by `WRITE_DEMO=1 npx vitest run tests/backendV1Demo.test.ts`: a seeded organisation with a record of every kind, driven through the real route handlers as each role. Every line below was asserted by the test, so this file is a record of a passing run, not a description.

## 1. The role tour

The same endpoints, called as each of the six roles. "Refused, explained" is a 403 carrying the role, the owner roles and who to ask. Deal values are shown to Management and Sales (Finance sees won deals only) and masked for everyone else; payments only to Management and Finance.

| Endpoint | MANAGEMENT | SALES | DELIVERY | FINANCE | RESTRICTED_TECHNICAL | CUSTOMER_SUPPORT |
|---|---|---|---|---|---|---|
| Audit log (GET /audit/events) | allowed | refused, explained | refused, explained | refused, explained | refused, explained | refused, explained |
| Integrations and website key (GET /integrations) | allowed | refused, explained | refused, explained | refused, explained | refused, explained | refused, explained |
| Payments summary (GET /payments/summary) | allowed | refused, explained | refused, explained | allowed | refused, explained | refused, explained |
| Invoices (GET /invoices) | allowed | refused, explained | refused, explained | allowed | refused, explained | refused, explained |
| Leads list (GET /leads) | allowed | allowed | refused, explained | refused, explained | refused, explained | refused, explained |
| Deals list (GET /deals) | allowed (value shown) | allowed (value shown) | allowed (value masked) | allowed (won deals only) | refused, explained | refused, explained |

## 2 and 3. A lead's day, and money

1. Sales creates a lead: accepted, Sales becomes its owner.
2. Sales opens it: 200.
3. Management opens the same lead: 200 (organisation scope).
4. Management reads the audit log: 200.
5. Sales tries to hand a new lead to someone else without the assign permission: 403.
6. Management of organisation A asks for organisation B's lead: 404, nothing returned.
7. Management of A creates a lead with organisation B's status: 400 validation error, never a server error.
8. Finance lists invoices: 200, amounts and numbers visible.
9. Sales, Delivery and Restricted Technical ask for the payments summary: 403, each with an explained refusal.
10. Sales opens Customer 360: no payment or invoice appears in it.
11. No session: 401 with the standard error envelope.

The other end-to-end demos are the per-stage ones: `docs/demo/stage-2.http`, `stage-3.http`, `stage-4.http` with `tests/stage2ExitGate.test.ts`, `stage3ExitGate.test.ts`, `stage4ExitGate.test.ts`. The full role-by-route matrix is `docs/PERMISSION_MATRIX_REPORT.md`.
