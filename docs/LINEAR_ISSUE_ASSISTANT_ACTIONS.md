# Linear issue to create: AI assistant that does things for people in the system

Linear was not connected when this was written (18 Nov 2026), so the issue is here ready to paste. Project "CRM Project", team Figbloom. Suggested title and labels below. Status: Backlog (not scheduled; Given decides).

**Title:** Assistant actions: let "Ask Figbloom" do work for people, with their permission and their confirmation

**Labels:** assistant, V2

## Why

A salesperson imported 24 schools into Companies when she meant them to be leads. Today she has to find that out, then use the new "Create leads" action by hand. She should be able to type to the assistant: "I uploaded new companies that I meant to be leads. Turn them into leads for me." and have it done, after one confirmation.

The assistant today (`docs/ASSISTANT.md`, FIG-1152) answers, lists, drafts and proposes. It never changes anything. This issue adds a small, safe set of actions.

## Goal

People can ask the assistant to do routine work in the CRM. Every action runs as that person, with exactly their permissions, after they confirm it, and leaves an audit entry.

## Scope (first version)

Actions the assistant may propose, each shown as a plain-language preview with "Confirm" and "Cancel":

1. Turn companies into leads (the companies the person just imported, or ones they name or filter).
2. Add a contact to a company from an email or phone.
3. Create a task or reminder for a record, with a due date.
4. Log a call, meeting or note on a lead or deal.
5. Reassign leads or companies (only for roles that have `leads.assign` / company reassignment).
6. Set the temperature, source or service interest on several leads at once.

Out of scope for the first version: anything about money (deal values, quotes, invoices, payments), approvals, discounts, moving a deal stage, deleting anything, sending email to customers.

## Rules (must hold)

- **Rule 9 (automations never decide):** the assistant never moves a deal stage, sets a discount or approves anything. A test enforces it.
- **Confirm before acting:** nothing changes until the person confirms the preview. The preview lists how many records and which ones (first 10 and a count).
- **Same permissions as the person:** each action calls the same service the screen calls, as that person. A role that cannot do it by hand cannot do it through the assistant, and is told why.
- **Masking (rule 7):** the assistant never reads or says values the role cannot see.
- **Tenant isolation (rule 8):** actions only touch the person's own organisation.
- **Limits:** at most 100 records per action; per-person and per-organisation request limits as today.
- **Audit:** every action records "done by the assistant at the request of <person>", with the request text and the records changed.
- **Undo:** where the action can be reversed (leads created from companies, reassignments), the result offers "Undo".
- **Injection safety:** record text stays untrusted data (existing defences). An instruction found inside a record can never trigger an action.

## Acceptance criteria

- [ ] "Turn the companies I imported today into leads" shows a preview (count and names), creates the leads on Confirm, and reports what was created and what was skipped (for example, a company that already has a lead).
- [ ] Each of the six actions has a preview, a confirm step, an audit entry and a result summary.
- [ ] A Sales user cannot reassign to someone else; a Delivery user cannot create leads; both get a clear explanation.
- [ ] No action can read or reveal deal values for a role without value access.
- [ ] A test proves the assistant cannot move a deal stage, set a discount or approve anything.
- [ ] A test proves an instruction hidden in a company's notes does not trigger an action.
- [ ] Cross-organisation test: an action cannot touch another organisation's records.
- [ ] The assistant can be switched off per organisation (the existing setting) and then offers no actions.
- [ ] Works on mobile.

## Design notes

- Reuse the existing confirm flow (`docs/ASSISTANT.md`, "Confirm before acting") and extend the tool list with one tool per action, each returning a proposal, not a change.
- The apply step calls the existing services (`createLead`, `createContact`, tasks, activities, assign), so validation and duplicate checks stay in one place.
- Needs a way to refer to "the companies I just imported": the import run id is already recorded in the audit trail; use it.
- Depends on: the "Create leads from companies" screen action (done 18 Nov 2026), `ANTHROPIC_API_KEY` configured per environment.
