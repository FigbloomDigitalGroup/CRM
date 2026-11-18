import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Migration } from "../../../../src/ui/screens/settings/Migration";
import { page, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

import * as clientModule from "../../../../src/ui/data/client";

vi.mock("../../../../src/ui/data/client", async (orig) => ({ ...(await orig<typeof import("../../../../src/ui/data/client")>()), getCsvText: vi.fn(async () => "a,b\n1,2\n") }));

const KEYS = ["configuration.manage"];
const STEPS = ["SOURCE", "UPLOAD", "MAP", "VALIDATE", "DRY_RUN", "IMPORT", "REVIEW"];

const ENTITIES = {
  items: [
    { entity: "LEAD", maxRows: 50000, sourceKinds: ["TEMPLATE", "GENERIC"], fields: [{ key: "email", label: "Email", type: "email", required: true, options: null, valueMapping: null, help: null }, { key: "status", label: "Status", type: "choice", required: false, options: ["NEW", "QUALIFIED"], valueMapping: "leadStatuses", help: null }, { key: "company", label: "Company", type: "text", required: false, options: null, valueMapping: null, help: "The company name." }] },
    { entity: "DEAL", maxRows: 50000, sourceKinds: ["TEMPLATE"], fields: [] },
  ],
  duplicatePolicies: ["SKIP", "UPDATE", "CREATE"],
  steps: STEPS,
};

const COUNTS = { total: 0, valid: 0, warnings: 0, errors: 0, duplicates: 0, processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 };

function session(step: string, over: Record<string, unknown> = {}) {
  const at = STEPS.indexOf(step);
  return {
    id: "s-1",
    entity: "LEAD",
    sourceKind: "TEMPLATE",
    status: "DRAFT",
    step,
    running: false,
    steps: STEPS.map((key, i) => ({ key, state: i < at ? "done" : i === at ? "current" : "todo" })),
    file: at >= 2 ? { name: "leads-2026.csv", headers: ["Email", "Stage", "Company name"], rows: 120 } : null,
    mapping: null,
    valueMappings: null,
    duplicatePolicy: "SKIP",
    options: { createMissingCompanies: false },
    counts: COUNTS,
    progress: 0,
    validation: null,
    dryRun: null,
    rollback: { canRollback: false, deadline: null, rolledBackAt: null, result: null },
    warnings: [],
    failureMessage: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** The wizard against a session that the test moves along, the way the API would. */
function wizard(initial: ReturnType<typeof session>, over: Record<string, Handler> = {}) {
  const state = { s: initial };
  const handlers: Record<string, Handler> = {
    listMigrationSessions: () => page([state.s]),
    getMigrationSession: () => state.s,
    listMigrationEntities: () => ENTITIES,
    listMigrationIssues: () => page([]),
    ...over,
  };
  return { state, ...stubClient(handlers) };
}

async function openFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Continue|Open report/ }));
}

describe("Data migration wizard (S7, FIG-1110)", () => {
  it("starts with a plain explanation and the earlier migrations", async () => {
    const { client } = wizard(session("MAP", { status: "UPLOADED" }));
    const { container } = renderScreen(<Migration />, client, { permissionKeys: KEYS });
    expect(await screen.findByText(/Nothing goes live until the dry run has been checked/)).toBeInTheDocument();
    expect(await screen.findByText(/Leads · leads-2026.csv/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("step 1: starts a deal migration with the duplicate policy and 'create missing companies' (FIG-800)", async () => {
    const user = userEvent.setup();
    const { client, calls } = wizard(session("UPLOAD"), { createMigrationSession: () => session("UPLOAD", { entity: "DEAL" }), listMigrationSessions: () => page([]) });
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Start a migration" }));
    await user.selectOptions(await screen.findByLabelText("What are you bringing in?"), "Deals");
    await user.selectOptions(screen.getByLabelText("When a record already exists"), "Update the existing record");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(calls.find((c) => c.id === "createMigrationSession")?.args.body).toEqual({ entity: "DEAL", sourceKind: "TEMPLATE", duplicatePolicy: "UPDATE", createMissingCompanies: true }));
    expect(await screen.findByRole("heading", { name: "Upload your file" })).toBeInTheDocument();
  });

  it("step 2: refuses a file that is not a CSV or spreadsheet before sending it, and sends a good one", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { client, calls } = wizard(session("UPLOAD"), { uploadMigrationFile: () => ({ session: session("MAP"), suggestedMapping: {} }) });
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    const input = await screen.findByLabelText("Migration file");
    await user.upload(input, new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Choose a .csv or .xlsx file.")).toBeInTheDocument();
    expect(calls.some((c) => c.id === "uploadMigrationFile")).toBe(false);
    await user.upload(input, new File(["Email\na@b.co\n"], "leads.csv", { type: "text/csv" }));
    await waitFor(() => expect(calls.some((c) => c.id === "uploadMigrationFile")).toBe(true));
    const body = calls.find((c) => c.id === "uploadMigrationFile")!.args.body as FormData;
    expect((body.get("file") as File).name).toBe("leads.csv");
  });

  it("step 3: will not continue until every required field is mapped, then saves the mapping and a preset", async () => {
    const user = userEvent.setup();
    const { client, calls } = wizard(session("MAP", { status: "UPLOADED" }), { setMigrationMapping: () => session("VALIDATE", { status: "MAPPED" }) });
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    const save = await screen.findByRole("button", { name: "Save mapping and continue" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Map the required fields first: Email/)).toBeInTheDocument();
    await user.click(save);
    expect(calls.some((c) => c.id === "setMigrationMapping")).toBe(false);
    await user.selectOptions(screen.getByLabelText("Column for Email"), "Email");
    await user.selectOptions(screen.getByLabelText("Column for Status"), "Stage");
    await user.type(screen.getByLabelText("Save this mapping for next time as"), "Sales tracker");
    await user.click(screen.getByRole("button", { name: "Save mapping and continue" }));
    await waitFor(() => expect(calls.find((c) => c.id === "setMigrationMapping")?.args.body).toEqual({ mapping: { email: "Email", status: "Stage" }, duplicatePolicy: "SKIP", savePresetAs: "Sales tracker" }));
  });

  it("step 4: shows what was read, the bad rows, and unknown values; the error report downloads", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const validated = session("VALIDATE", { status: "VALIDATED", counts: { ...COUNTS, total: 120, valid: 110, warnings: 4, errors: 6 }, validation: { unmappedValues: [{ field: "status", value: "Hot lead", count: 7 }], truncated: false } });
    const { client, calls } = wizard(validated, {
      listMigrationIssues: () => page([{ row: 4, phase: "VALIDATE", severity: "ERROR", field: "email", message: "Email is not valid." }, { row: 9, phase: "VALIDATE", severity: "WARNING", field: "company", message: "Company will be created." }]),
      getMigrationErrorReport: () => "row,problem\n4,Email is not valid.\n",
      setMigrationMapping: () => validated,
      validateMigration: () => validated,
    });
    const { container } = renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    const counts = (await screen.findByRole("heading", { name: "Check the file" })).closest("section")!;
    expect(within(counts).getByText("110").nextSibling).toHaveTextContent("Ready");
    expect(within(counts).getByText("6").nextSibling).toHaveTextContent("Errors");
    const bad = (await screen.findByRole("heading", { name: "Rows to fix (2)" })).closest("section")!;
    expect(within(bad).getByText("Email is not valid.")).toBeInTheDocument();
    await user.click(within(bad).getByRole("button", { name: "Download error report" }));
    await waitFor(() => expect(clientModule.getCsvText).toHaveBeenCalledWith("/api/orgs/figbloom/data-migration/sessions/s-1/errors", { phase: "VALIDATE" }));
    // Unknown values are listed, never guessed: choose what 'Hot lead' means, then check again.
    await user.selectOptions(screen.getByLabelText("Treat Hot lead as"), "QUALIFIED");
    await user.click(screen.getByRole("button", { name: "Apply and check again" }));
    await waitFor(() => expect(calls.find((c) => c.id === "setMigrationMapping")?.args.body).toEqual({ valueMappings: { status: { "Hot lead": "QUALIFIED" } } }));
    await waitFor(() => expect(calls.some((c) => c.id === "validateMigration")).toBe(true));
    expect(await violations(container)).toEqual([]);
  });

  it("step 4: cannot continue when no row is usable", async () => {
    const user = userEvent.setup();
    const { client } = wizard(session("VALIDATE", { status: "VALIDATED", counts: { ...COUNTS, total: 5, errors: 5 }, validation: { unmappedValues: [], truncated: false } }));
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    expect(await screen.findByRole("button", { name: "Continue to the dry run" })).toHaveAttribute("aria-disabled", "true");
  });

  it("step 5: the dry run shows exactly what will change, and the import needs the confirmation (nothing is written before)", async () => {
    const user = userEvent.setup();
    const dry = session("DRY_RUN", { status: "DRY_RUN_DONE", dryRun: { wouldCreate: 90, wouldUpdate: 12, wouldSkip: 8, duplicates: 8, errors: 6, warnings: 4, newCompanies: 15, newContacts: 0, newTags: 2, truncated: false, sample: { create: [{ row: "2", email: "a@b.co", company: "Acme" }], update: [], duplicate: [{ row: 7, reason: "Same email as row 3" }] } } });
    const { client, calls } = wizard(dry, { startMigrationImport: () => session("IMPORT", { status: "IMPORTING", running: true, progress: 10, counts: { ...COUNTS, total: 120, processed: 12 } }) });
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    const panel = (await screen.findByRole("heading", { name: "Dry run" })).closest("section")!;
    expect(within(panel).getByText("90").nextSibling).toHaveTextContent("Would add");
    expect(within(panel).getByText("12").nextSibling).toHaveTextContent("Would update");
    expect(within(panel).getByText("15").nextSibling).toHaveTextContent("New companies");
    expect(within(panel).getByRole("table", { name: "Sample of records that would be added" })).toHaveTextContent("Acme");
    expect(within(panel).getByText(/Row 7: Same email as row 3/)).toBeInTheDocument();
    const go = screen.getByRole("button", { name: "Import now" });
    expect(go).toHaveAttribute("aria-disabled", "true");
    await user.click(go);
    expect(calls.some((c) => c.id === "startMigrationImport")).toBe(false);
    await user.click(screen.getByRole("checkbox", { name: /I have read the dry run/ }));
    await user.click(screen.getByRole("button", { name: "Import now" }));
    await waitFor(() => expect(calls.find((c) => c.id === "startMigrationImport")?.args.body).toEqual({ confirm: true }));
    expect(calls.some((c) => c.id === "dryRunMigration")).toBe(false);
  });

  it("step 6: shows progress while importing, with a status others can hear", async () => {
    const user = userEvent.setup();
    const { client } = wizard(session("IMPORT", { status: "IMPORTING", running: true, progress: 40, counts: { ...COUNTS, total: 120, processed: 48 } }));
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    expect(await screen.findByText("Importing… 48 of 120 rows (40%)")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("step 7: reports what happened, explains problem rows, and rolls back within the window", async () => {
    const user = userEvent.setup();
    const done = session("REVIEW", { status: "COMPLETED_WITH_ERRORS", counts: { ...COUNTS, total: 120, created: 90, updated: 12, skipped: 8, failed: 4, errors: 6 }, rollback: { canRollback: true, deadline: new Date(Date.now() + 3 * 86400_000).toISOString(), rolledBackAt: null, result: null } });
    const { client, calls } = wizard(done, { rollbackMigration: () => ({ ...done, status: "ROLLED_BACK" }) });
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    const report = (await screen.findByRole("heading", { name: "Import report" })).closest("section")!;
    expect(within(report).getByText("90").nextSibling).toHaveTextContent("Added");
    expect(within(report).getByText("10").nextSibling).toHaveTextContent("Failed");
    expect(screen.getByText(/Some rows were not imported/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Roll back this import" }));
    const confirm = await screen.findByRole("dialog", { name: "Roll back this import?" });
    expect(confirm).toHaveTextContent(/Anything people edited afterwards/);
    await user.click(within(confirm).getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(calls.some((c) => c.id === "rollbackMigration")).toBe(true));
  });

  it("step 7: rollback is unavailable, with the reason, once the window has ended", async () => {
    const user = userEvent.setup();
    const { client, calls } = wizard(session("REVIEW", { status: "COMPLETED", counts: { ...COUNTS, created: 10 }, rollback: { canRollback: false, deadline: new Date(Date.now() - 86400_000).toISOString(), rolledBackAt: null, result: null } }));
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    const rb = await screen.findByRole("button", { name: "Roll back this import" });
    expect(rb).toHaveAttribute("aria-disabled", "true");
    await user.click(rb);
    expect(calls.some((c) => c.id === "rollbackMigration")).toBe(false);
  });

  it("says plainly when a rollback already happened, and what it kept", async () => {
    const user = userEvent.setup();
    const { client } = wizard(session("REVIEW", { status: "ROLLED_BACK", counts: { ...COUNTS, created: 10 }, rollback: { canRollback: false, deadline: null, rolledBackAt: "2026-10-28T09:00:00.000Z", result: { removed: 8, restored: 1, kept: 1 } } }));
    renderScreen(<Migration />, client, { permissionKeys: KEYS });
    await openFirst(user);
    expect(await screen.findByText(/8 removed, 1 restored, 1 kept because they changed since/)).toBeInTheDocument();
  });
});
