# Traceability map: screen to issue to code

One row per Screen Checklist ID (92 rows: 54 V1, 29 V1.1, 9 V2), built from `Figbloom Screen Checklist.dc.html` and the "Design reference" line of every issue in the Linear CRM Project (22 Oct 2026). The checklist repeats S5 to S8 for two different sets of screens; the second set is `S5#2` to `S8#2` here. Update the **Status** column in the same pull request that lands a screen.

- **Backend** and **Frontend** list the issues that build the screen's API and UI (`code (FIG-id)`). Rows marked † are linked by inference because no issue names that screen; confirm when the issue is worked.
- **Code** is filled as work lands: the route or component path in `src/`.
- **Existing issue** is the older FIG issue the checklist names (kept and re-scoped).
- Status values: `Not started`, `Backend done`, `Frontend done`, `Done`, `Frozen (live)`.

| ID | Screen | Release | Backend | Frontend | Existing issue | Code | Status |
|---|---|---|---|---|---|---|---|
| A1 | Sign in | V1 | existing (frozen) | F1.07 (FIG-1082) |  | | Frozen (live) |
| A2 | Sign up → awaiting access | V1 | existing (frozen) | F1.07 (FIG-1082) |  | | Frozen (live) |
| A3 | Forgot / reset password, accept invite | V1 | existing (frozen) | F1.07 (FIG-1082) |  | | Frozen (live) |
| A4 | Session expired | V1 | B1.04 (FIG-1020) | F1.07 (FIG-1082) |  | | Not started |
| G1 | App shell: sidebar, top bar, quick create, review bar | V1 | B1.10 (FIG-1026)† | F1.06 (FIG-1081)<br>F1.03 (FIG-1078)<br>F1.02 (FIG-1077) |  | | Not started |
| G2 | Global search dropdown + results page | V1 | B2.12 (FIG-1041) | F2.11 (FIG-1093) | FIG-787 | | Not started |
| G3 | Notification bell + notification centre | V1 | B2.11 (FIG-1040) | F2.12 (FIG-1094) |  | | Not started |
| D1 | Home: Sales “Today” | V1 | B2.13 (FIG-1042) | F2.09 (FIG-1091) | FIG-443 | | Not started |
| D2 | Home: Management | V1 | B2.14 (FIG-1043)<br>B2.13 (FIG-1042) | F2.09 (FIG-1091) | FIG-443 | | Not started |
| D3 | Home: Delivery, Finance, Technical | V1 | B3.04 (FIG-1050)<br>B1.03 (FIG-1019)<br>B2.13 (FIG-1042)<br>B2.09 (FIG-1038) | F2.10 (FIG-1092)<br>F2.07 (FIG-1089) | FIG-443 | | Not started |
| L1 | Leads list + bulk actions | V1 | B1.03 (FIG-1019)<br>B2.16 (FIG-1045)<br>B2.02 (FIG-1031) | F2.01 (FIG-1083) | FIG-789 | | Not started |
| L2 | Lead detail + progress strip + qualification | V1 | B2.04 (FIG-1033)<br>B2.16 (FIG-1045)<br>B2.01 (FIG-1030) | F2.02 (FIG-1084) |  | | Not started |
| L3 | Lead drawer, convert, lost reason, import/export | V1 | B2.04 (FIG-1033)<br>B2.05 (FIG-1034) | F2.03 (FIG-1085) | FIG-596 | | Not started |
| P1 | Deals board (drag + Move to…) and list | V1 | B2.07 (FIG-1036)<br>B2.06 (FIG-1035) | F2.04 (FIG-1086) | FIG-790 | | Not started |
| P2 | Deal detail + proposals | V1 | B2.16 (FIG-1045)<br>B2.07 (FIG-1036)<br>B2.06 (FIG-1035) | F2.05 (FIG-1087) | FIG-789 | | Not started |
| P3 | Won-deal handoff dialog | V1 | B2.08 (FIG-1037) | F2.06 (FIG-1088) | FIG-792 | | Not started |
| P4 | Delivery receiving view (Handoffs) | V1 | B1.03 (FIG-1019)<br>B2.08 (FIG-1037) | F2.06 (FIG-1088) | FIG-792 | | Not started |
| T1 | Tasks grouped by due state | V1 | B1.03 (FIG-1019)<br>B2.09 (FIG-1038) | F2.07 (FIG-1089) | FIG-789 | | Not started |
| T2 | Calendar month / week / day / list | V1 | B2.10 (FIG-1039) | F2.08 (FIG-1090) | FIG-794 | | Not started |
| C1 | Companies list | V1 | B3.10 (FIG-1056)<br>B3.02 (FIG-1048)<br>B2.16 (FIG-1045) | F3.01 (FIG-1095) | FIG-789 | | Not started |
| C2 | Customer 360 | V1 | B3.05 (FIG-1051)<br>B3.03 (FIG-1049)<br>B3.02 (FIG-1048)<br>B3.01 (FIG-1047)<br>B2.16 (FIG-1045)<br>B2.07 (FIG-1036) | F3.01 (FIG-1095) |  | | Not started |
| C3 | Contacts list + contact detail (call / WhatsApp → log prompt) | V1 | B3.10 (FIG-1056)<br>B3.08 (FIG-1054) | F3.02 (FIG-1096) | FIG-791 | | Not started |
| C4 | Merge duplicates | V1 | B2.04 (FIG-1033) | F3.03 (FIG-1097) |  | | Not started |
| R1 | Reports (organisation) incl. customer reports | V1 | B3.09 (FIG-1055) | F3.07 (FIG-1101) | FIG-793 | | Not started |
| R2 | My metrics (personal) | V1 | B3.09 (FIG-1055)<br>B2.13 (FIG-1042) | F2.10 (FIG-1092) | FIG-443 | | Not started |
| F1 | Payments tracker | V1 | B3.04 (FIG-1050)<br>B3.03 (FIG-1049)<br>B1.03 (FIG-1019) | F3.06 (FIG-1100) |  | | Not started |
| S1 | Settings: profile, members, website, email, reference data, template | V1 | B4.01 (FIG-1058)<br>B1.12 (FIG-1028) | F4.04 (FIG-1106) | FIG-750 | | Not started |
| S2 | Organisation audit log | V1 | FIG-799 | F4.05 (FIG-1107) | FIG-799 | | Not started |
| S3 | Notification preferences + PWA install | V1 | B4.07 (FIG-1064)<br>B1.11 (FIG-1027) | F4.12 (FIG-1114)<br>F4.03 (FIG-1105) | FIG-791 | | Not started |
| S4 | No access (explained) | V1 | B1.01 (FIG-1017)<br>B1.02 (FIG-1018) | F1.05 (FIG-1080)<br>F1.02 (FIG-1077) |  | | Not started |
| E1 | Conversations hub + Needs-linking queue | V1 | B3.07 (FIG-1053) | F3.04 (FIG-1098) |  | | Not started |
| E2 | Renewals & retention | V1 | B7.08 (FIG-1190)<br>B3.06 (FIG-1052)<br>B3.05 (FIG-1051)<br>B3.02 (FIG-1048)<br>B2.18 (FIG-1066) | F3.05 (FIG-1099) |  | | Not started |
| S5 | Settings: Automations | V1 | B4.02 (FIG-1059) | F4.06 (FIG-1108) |  | | Not started |
| S6 | Settings: Integrations | V1 | B4.03 (FIG-1060) | F4.06 (FIG-1108) |  | | Not started |
| S7 | Settings: Data migration wizard | V1 | B4.04 (FIG-1061)<br>B2.18 (FIG-1066)<br>B1.07 (FIG-1023) | F4.08 (FIG-1110) |  | | Not started |
| S8 | Settings: Security & access | V1 | B1.05 (FIG-1021)<br>B1.04 (FIG-1020) | F4.09 (FIG-1111) | FIG-437 | | Not started |
| S9 | Settings: Data & privacy | V1 | B4.05 (FIG-1062)<br>B2.18 (FIG-1066)<br>B2.05 (FIG-1034) | F4.09 (FIG-1111) |  | | Not started |
| M1 | Mobile: Today, Leads, Quick capture | V1 | B4.08 (FIG-1065)<br>B4.07 (FIG-1064)<br>B2.04 (FIG-1033) | F4.12 (FIG-1114)<br>F4.10 (FIG-1112)<br>F1.06 (FIG-1081) | FIG-791 | | Not started |
| M2 | Mobile: Customer lookup, record, call/WhatsApp → log sheet | V1 | B4.07 (FIG-1064)<br>B3.08 (FIG-1054) | F4.11 (FIG-1113) | FIG-791 | | Not started |
| M3 | Mobile: Tasks, Notifications, More, read-only pipeline | V1 | B4.07 (FIG-1064) | F4.11 (FIG-1113) | FIG-791 | | Not started |
| Q1 | Quote builder, document preview, versions | V1.1 | B6.11 (FIG-1143)<br>B7.07 (FIG-1189)<br>B6.12 (FIG-1144) | F6.09 (FIG-1168) |  | | Not started |
| Q2 | Client e-signature + deposit request | V2 | B7.05 (FIG-1187)<br>B7.07 (FIG-1189)<br>B7.04 (FIG-1186) | F7.02 (FIG-1193) |  | | Not started |
| Q3 | Approvals inbox | V1.1 | B6.13 (FIG-1145) | F6.10 (FIG-1169) |  | | Not started |
| Q4 | Forecast & targets (mine / team) | V1.1 | B6.14 (FIG-1146) | F6.11 (FIG-1170) | FIG-793 | | Not started |
| X1 | Record extras: attachments, tags, custom fields, comments, follow, score, health | V1 | B2.15 (FIG-1044)<br>B2.03 (FIG-1032)<br>B1.07 (FIG-1023) | F3.08 (FIG-1102)<br>F1.06 (FIG-1081)<br>F1.05 (FIG-1080) |  | | Not started |
| X2 | Ask Figbloom assistant | V1.1 | B7.08 (FIG-1190)<br>B6.20 (FIG-1152) | F6.12 (FIG-1171) |  | | Not started |
| X3 | Command palette (Ctrl/Cmd+K), Help and What’s new | V1.1 | B6.17 (FIG-1149) | F6.13 (FIG-1172) |  | | Not started |
| X4 | Saved views pinned in the sidebar | V1.1 | B6.16 (FIG-1148) | F6.14 (FIG-1173) |  | | Not started |
| S5#2 | Settings: templates, tags, custom fields | V1 | B4.06 (FIG-1063)<br>B2.01 (FIG-1030) | F4.07 (FIG-1109) |  | | Not started |
| S6#2 | Settings: catalogue, pipelines & stage rules, sequences, web forms, approval rules | V1.1 | B7.07 (FIG-1189)<br>B6.19 (FIG-1151)<br>B6.18 (FIG-1150)<br>B6.15 (FIG-1147)<br>B6.13 (FIG-1145)<br>B6.10 (FIG-1142) | F6.15 (FIG-1174) |  | | Not started |
| S7#2 | Settings: email & calendar connection, AI assistant, two-step sign-in | V1.1 | B6.21 (FIG-1153)<br>B6.20 (FIG-1152)<br>B6.02 (FIG-1134) | F6.08 (FIG-1167)<br>F6.16 (FIG-1175) | FIG-437 | | Not started |
| S8#2 | Settings: roles & field access, developers (API tokens, webhooks) | V2 | B7.06 (FIG-1188) | F7.03 (FIG-1194) |  | | Not started |
| A5 | Two-step sign-in code screen (after the frozen sign-in) | V1.1 | B6.02 (FIG-1134) | F6.08 (FIG-1167) | FIG-437 | | Not started |
| M4 | Mobile: camera attachments, business-card capture, waiting-to-sync queue | V1.1 | B6.22 (FIG-1154)<br>B4.07 (FIG-1064) | F6.18 (FIG-1177) | FIG-791 | | Not started |
| A6 | Sign-in chips: Dev Super Admin, Dev Customer Support | V1.1 | B0.09 (FIG-1196)<br>B0.08 (FIG-1016) | F6.04 (FIG-1163)<br>F1.07 (FIG-1082) |  | | Frozen (live) |
| PL1 | Platform home | V1.1 | B6.07 (FIG-1139)<br>B0.09 (FIG-1196) | F6.01 (FIG-1160) |  | | Not started |
| PL2 | Organisations list | V1.1 | B6.04 (FIG-1136)<br>B0.09 (FIG-1196) | F6.02 (FIG-1161) |  | | Not started |
| PL3 | Provision organisation wizard | V1.1 | B6.04 (FIG-1136)<br>B0.09 (FIG-1196) | F6.02 (FIG-1161) |  | | Not started |
| PL4 | Organisation detail | V1.1 | B6.04 (FIG-1136)<br>B0.09 (FIG-1196) | F6.02 (FIG-1161) |  | | Not started |
| PL5 | Suspend, reactivate and offboard dialogs | V1.1 | B6.05 (FIG-1137)<br>B0.09 (FIG-1196) | F6.02 (FIG-1161) |  | | Not started |
| PL6 | Offboarding and data requests | V1.1 | B6.09 (FIG-1141)<br>B0.09 (FIG-1196) | F6.03 (FIG-1162) | FIG-444 | | Not started |
| PL7 | Support access (break-glass) | V2 | B7.01 (FIG-1183)<br>B0.09 (FIG-1196) | F7.01 (FIG-1192) |  | | Not started |
| PL8 | Platform audit log | V1.1 | B6.06 (FIG-1138)<br>B0.09 (FIG-1196) | F6.03 (FIG-1162) |  | | Not started |
| PL9 | System health | V1.1 | B6.07 (FIG-1139)<br>B0.09 (FIG-1196)<br>B2.18 (FIG-1066) | F6.03 (FIG-1162) |  | | Not started |
| PL10 | Platform admins | V1.1 | B6.08 (FIG-1140)<br>B0.09 (FIG-1196) | F6.04 (FIG-1163) |  | | Not started |
| PL11 | Platform security | V1.1 | B6.08 (FIG-1140)<br>B0.09 (FIG-1196) | F6.04 (FIG-1163) |  | | Not started |
| PL12 | Flags and limits | V2 | B7.02 (FIG-1184)<br>B0.09 (FIG-1196) | F7.01 (FIG-1192) |  | | Not started |
| PL13 | Announcements | V2 | B7.03 (FIG-1185)<br>B0.09 (FIG-1196) | F7.01 (FIG-1192) |  | | Not started |
| PL14 | Verify it’s you (platform second step) | V1.1 | B6.08 (FIG-1140)<br>B0.09 (FIG-1196) | F6.04 (FIG-1163) | FIG-437 | | Not started |
| PL15 | Not found (org user at platform address) | V1.1 | B6.03 (FIG-1135)<br>B0.09 (FIG-1196) | F6.04 (FIG-1163) |  | | Not started |
| PLM | Platform mobile: Home, Health, Approvals | V1.1 | B6.07 (FIG-1139)<br>B6.09 (FIG-1141)† | F6.05 (FIG-1164) |  | | Not started |
| OS1 | Suspended organisation screen | V1.1 | B6.05 (FIG-1137) | F6.07 (FIG-1166) |  | | Not started |
| OS2 | Support access approval card | V2 | B7.01 (FIG-1183) | F7.01 (FIG-1192) |  | | Not started |
| OS3 | Support access banner | V2 | B7.01 (FIG-1183) | F7.01 (FIG-1192) |  | | Not started |
| OS4 | Settings › Support access history | V2 | B7.01 (FIG-1183) | F7.01 (FIG-1192) |  | | Not started |
| OS5 | Maintenance and announcement banner | V2 | B7.03 (FIG-1185) | F7.01 (FIG-1192) |  | | Not started |
| OS6 | Settings › Data requests (organisation side) | V1.1 | B4.05 (FIG-1062)<br>B6.09 (FIG-1141) | F6.07 (FIG-1166) | FIG-444 | | Not started |
| AP1 | Preferences shell: Profile, Notifications, Appearance, Security | V1 | B1.08 (FIG-1024)<br>B1.06 (FIG-1022) | F4.01 (FIG-1103) |  | | Not started |
| AP2 | Appearance: themes, page colours, density, text size, accessibility, start page, sidebar, date and time | V1 | B1.08 (FIG-1024) | F4.01 (FIG-1103)<br>F1.01 (FIG-1076) |  | | Not started |
| AP3 | Profile picture upload and crop | V1 | B1.07 (FIG-1023)<br>B1.06 (FIG-1022) | F4.02 (FIG-1104) |  | | Not started |
| AP4 | Your own colours with contrast check | V1.1 | B1.08 (FIG-1024) | F6.17 (FIG-1176) |  | | Not started |
| AP5 | Shared-look read-only variant | V1 | B1.09 (FIG-1025) | F4.02 (FIG-1104) |  | | Not started |
| AP6 | Notifications tab per role | V1 | B1.11 (FIG-1027) | F4.03 (FIG-1105) | FIG-791 | | Not started |
| AP7 | Security: my sessions, sign-in history, password, two-step | V1 | B6.02 (FIG-1134)<br>B1.04 (FIG-1020) | F4.03 (FIG-1105) | FIG-437 | | Not started |
| AP8 | Reset to default confirmation | V1 | B1.08 (FIG-1024) | F4.01 (FIG-1103)<br>F1.01 (FIG-1076) |  | | Not started |
| AP9 | Organisation profile: logo, default theme, allow personalisation | V1 | B1.09 (FIG-1025) | F4.04 (FIG-1106)<br>F1.01 (FIG-1076) |  | | Not started |
| TB1 | Top bar with identity block, per role | V1 | B1.10 (FIG-1026)<br>B1.09 (FIG-1025) | F1.04 (FIG-1079) |  | | Not started |
| TB2 | Identity popover | V1 | B1.10 (FIG-1026)<br>B1.04 (FIG-1020) | F1.04 (FIG-1079) |  | | Not started |
| TB3 | Session-expiring prompt | V1 | B1.04 (FIG-1020) | F1.04 (FIG-1079) | FIG-437 | | Not started |
| TB4 | Organisation switcher | V1.1 | B6.01 (FIG-1133) | F6.06 (FIG-1165) | FIG-437 | | Not started |
| TB5 | Top bar at tablet and 375px | V1 | B1.10 (FIG-1026) | F1.04 (FIG-1079) |  | | Not started |
| TB6 | Top bar in support view and in Platform console | V1.1 | B1.10 (FIG-1026)<br>B6.03 (FIG-1135)† | F6.01 (FIG-1160) |  | | Not started |

## Coverage

- Rows: 92. Rows without a backend or frontend issue after the links above: 0.
- A1 to A3 are the frozen pages (backend already live; FIG-437). Their frontend issues only add the dev sign-in chips (F1.07) and never touch the pages.
