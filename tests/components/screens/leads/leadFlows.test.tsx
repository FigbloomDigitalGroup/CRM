import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { parseCsv, toCsv } from "../../../../src/ui/screens/leads/csv";
import { ConvertDialog } from "../../../../src/ui/screens/leads/ConvertDialog";
import { ExportDialog } from "../../../../src/ui/screens/leads/ExportDialog";
import { ImportWizard } from "../../../../src/ui/screens/leads/ImportWizard";
import { LeadDrawer } from "../../../../src/ui/screens/leads/LeadDrawer";
import { LostDialog } from "../../../../src/ui/screens/leads/LostDialog";
import { MGMT_KEYS, SALES_KEYS, apiError, axeViolations, leadRow, page, renderScreen } from "./harness";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/o/figbloom/leads" }));

/** F2.03 (FIG-1085, design L3): the lead drawer, convert, lost reason, import and export. */

describe("csv", () => {
  it("reads quoted fields, doubled quotes, commas and line breaks inside quotes, and a trailing blank line", () => {
    expect(parseCsv('name,notes\r\n"Wafula, Ltd","said ""hi""\nthen left"\r\nTwiga,\r\n')).toEqual([
      ["name", "notes"],
      ["Wafula, Ltd", 'said "hi"\nthen left'],
      ["Twiga", ""],
    ]);
    expect(parseCsv(toCsv([["a", 'b,"c"'], ["1", "2"]]))).toEqual([["a", 'b,"c"'], ["1", "2"]]);
    expect(parseCsv("﻿name,phone\nA,1")[0]).toEqual(["name", "phone"]);
  });
});

describe("the lead drawer (New lead / Edit lead)", () => {
  const handlers = { getCompanies: page([]), listLeads: page([]) };

  it("needs only a name, creates the company and the lead, and goes to the new lead", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const { calls } = renderScreen(<LeadDrawer onClose={() => undefined} onSaved={onSaved} />, {
      keys: SALES_KEYS,
      handlers: { ...handlers, postCompanies: { company: { id: "co-new" } }, createLead: { lead: { id: "lead-new" }, duplicates: [], possibleDuplicates: [], hiddenDuplicates: 0 }, patchLeadsByLeadId: {} },
    });
    expect(screen.getByRole("dialog", { name: "New lead" })).toBeInTheDocument();
    expect(screen.getByText("Capture now, qualify later.")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /Create lead/ });
    expect(create).toBeDisabled(); // nothing to save without the name
    // A salesperson's new lead is theirs: the owner is locked, with the reason.
    expect(screen.getByRole("combobox", { name: /^Owner/ })).toBeDisabled();
    expect(screen.getByText("Leads you create are yours. Management can reassign them.")).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: /Company or person/ }) /* an input with suggestions */, "Sarova Hotels");
    await user.selectOptions(screen.getByRole("combobox", { name: "Service interest" }), "svc-cctv");
    await user.click(screen.getByRole("button", { name: "Hot" }));
    await user.click(create);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("lead-new"));
    expect(calls.find((c) => c.id === "postCompanies")?.args).toMatchObject({ body: { name: "Sarova Hotels" } });
    expect(calls.find((c) => c.id === "createLead")?.args).toMatchObject({ body: { leadStatusId: "st-NEW", companyId: "co-new", serviceInterestId: "svc-cctv", temperature: "HOT" } });
    expect(calls.find((c) => c.id === "createLead")?.args.body).not.toHaveProperty("ownerMembershipId");
  });

  it("warns about a possible duplicate and still lets the lead be saved", async () => {
    const user = userEvent.setup();
    renderScreen(<LeadDrawer onClose={() => undefined} />, {
      keys: SALES_KEYS,
      handlers: { getCompanies: page([{ id: "co-9", name: "Sarova Hotels", ownerMembershipId: "m-mgmt" }]), listLeads: page([leadRow({ company: { id: "co-9", name: "Sarova Hotels" } })]) },
    });
    await user.type(screen.getByRole("combobox", { name: /Company or person/ }) /* an input with suggestions */, "Sarova Hotels");
    const warn = await screen.findByText(/Possible duplicate/, undefined, { timeout: 3000 });
    expect(warn.closest("[role=status]")).toHaveTextContent("Sarova Hotels already exists as a company (owner Dev Management) and has an open lead.");
    expect(screen.getByRole("link", { name: "Open existing record" })).toHaveAttribute("href", "/o/figbloom/companies/co-9");
    expect(screen.getByRole("button", { name: /Create lead/ })).toBeEnabled();
  });

  it("Management can choose the owner", async () => {
    renderScreen(<LeadDrawer onClose={() => undefined} />, { keys: MGMT_KEYS, roleName: "Management", membershipId: "m-mgmt", handlers });
    expect(screen.getByRole("combobox", { name: /^Owner/ })).toBeEnabled();
  });

  it("says why a company cannot be created and keeps the form, instead of failing silently", async () => {
    const user = userEvent.setup();
    renderScreen(<LeadDrawer onClose={() => undefined} />, { keys: SALES_KEYS.filter((k) => k !== "companies.create"), handlers });
    await user.type(screen.getByRole("combobox", { name: /Company or person/ }) /* an input with suggestions */, "Brand New Co");
    await user.click(screen.getByRole("button", { name: /Create lead/ }));
    expect(await screen.findByText(/your role cannot add companies/)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    renderScreen(<LeadDrawer onClose={() => undefined} />, { keys: SALES_KEYS, handlers });
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
  });
});

describe("Mark lost", () => {
  it("needs a reason, then sets Lost with it", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { calls } = renderScreen(<LostDialog leadId="lead-1" name="Wafula Ltd" onClose={() => undefined} onDone={onDone} />, { keys: SALES_KEYS, handlers: { patchLeadsByLeadId: {}, postActivities: {} } });
    expect(screen.getByRole("heading", { name: "Why was Wafula Ltd lost?" })).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Mark lost" });
    expect(confirm).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: "Price" }));
    await user.type(screen.getByRole("textbox", { name: "Note" }), "Went with a rival");
    await user.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((c) => c.id === "patchLeadsByLeadId")?.args).toMatchObject({ body: { leadStatusId: "st-LOST", lostReasonId: "lr-PRICE" } });
    expect(calls.find((c) => c.id === "postActivities")?.args).toMatchObject({ body: { leadId: "lead-1", description: "Went with a rival" } });
  });
});

describe("Convert to deal", () => {
  const lead = { ...leadRow(), company: { id: "co-1", name: "Wafula Ltd" }, contact: { id: "ct-1", firstName: "Amina", lastName: "Wafula", email: "a@w.example", phone: "+254700000001" } };

  it("shows what comes along, warns about duplicates without blocking, and converts", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { calls } = renderScreen(<ConvertDialog leadId="lead-1" onClose={() => undefined} onDone={onDone} />, {
      keys: MGMT_KEYS,
      roleName: "Management",
      membershipId: "m-mgmt",
      handlers: { getLeadsByLeadId: lead, getActivities: { ...page([]), total: 3 }, postLeadsCheckDuplicates: { duplicates: [{ entityType: "company", id: "co-2", label: "Wafula Limited", confidence: "high", reasons: [] }], possibleDuplicates: [], hiddenDuplicates: 0 }, postLeadsByLeadIdConvert: { id: "deal-9" } },
    });
    expect(await screen.findByRole("heading", { name: "Convert Wafula Ltd to a deal" })).toBeInTheDocument();
    expect(await screen.findByText(/3 timeline items and open tasks come with it/)).toBeInTheDocument();
    expect(screen.getByText("Existing company found · linked")).toBeInTheDocument();
    expect(screen.getByText("Amina Wafula")).toBeInTheDocument();
    expect(await screen.findByText(/Wafula Limited/)).toBeInTheDocument();
    await user.type(screen.getByRole("spinbutton", { name: /Value/ }), "150000");
    await user.click(screen.getByRole("button", { name: "Convert to deal" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((c) => c.id === "postLeadsByLeadIdConvert")?.args).toMatchObject({ params: { leadId: "lead-1" }, body: { companyId: "co-1", value: "150000" } });
    expect(push).toHaveBeenCalledWith("/o/figbloom/deals/deal-9");
  });

  it("asks for a value for every role that converts, because the converter owns the new deal and an owner always sees its value", async () => {
    renderScreen(<ConvertDialog leadId="lead-1" onClose={() => undefined} onDone={() => undefined} />, { keys: SALES_KEYS, handlers: { getLeadsByLeadId: lead, getActivities: page([]), postLeadsCheckDuplicates: { duplicates: [] } } });
    await screen.findByRole("heading", { name: /Convert/ });
    expect(screen.getByRole("spinbutton", { name: /Value/ })).toBeInTheDocument();
  });

  it("asks for a company name when the lead has none, and creates it on convert", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<ConvertDialog leadId="lead-1" onClose={() => undefined} onDone={() => undefined} />, {
      keys: SALES_KEYS,
      handlers: { getLeadsByLeadId: { ...lead, company: null, companyId: null }, getActivities: page([]), postLeadsCheckDuplicates: { duplicates: [] }, postLeadsByLeadIdConvert: { id: "deal-1" } },
    });
    const name = await screen.findByRole("textbox", { name: /Company name/ });
    await user.type(name, "New Co");
    expect(screen.getByText("No match found · will be created")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Convert to deal" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postLeadsByLeadIdConvert")?.args).toMatchObject({ body: { newCompany: { name: "New Co" } } }));
  });

  it("shows the API's own message when the conversion is refused", async () => {
    const user = userEvent.setup();
    renderScreen(<ConvertDialog leadId="lead-1" onClose={() => undefined} onDone={() => undefined} />, {
      keys: SALES_KEYS,
      handlers: { getLeadsByLeadId: lead, getActivities: page([]), postLeadsCheckDuplicates: { duplicates: [] }, postLeadsByLeadIdConvert: apiError(400, { message: "This lead has already been converted." }) },
    });
    await user.click(await screen.findByRole("button", { name: "Convert to deal" }));
    expect(await screen.findByText("This lead has already been converted.")).toBeInTheDocument();
  });
});

describe("Import CSV", () => {
  const csv = "name,phone,email,source,service\nWafula Ltd,+254700000001,a@w.example,Phone,CCTV\nTwiga Foods,+254700000002,,Website,Fleet / GPS\n,+254700000003,,,\n";
  const upload = (text: string) => new File([text], "leads.csv", { type: "text/csv" });

  it("maps the columns by the design's own names, imports, and reports duplicates and failures with a downloadable error report", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const created = vi.fn();
    const { calls } = renderScreen(<ImportWizard onClose={() => undefined} onDone={onDone} />, {
      keys: SALES_KEYS,
      handlers: {
        postLeadsImport: (args) => {
          created(args);
          return { totalRows: 3, created: 1, duplicatesSkipped: 1, alreadyConverted: 0, failed: 1, truncated: false, cancelled: false, errors: [{ row: 3, reason: "Possible duplicate of Twiga Foods. Skipped.", outcome: "duplicate" }, { row: 4, reason: "Missing name. Not imported.", outcome: "failed" }] };
        },
      },
    });
    expect(screen.getByText("Drop a .csv file here")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("CSV file"), upload(csv));
    expect(await screen.findByRole("heading", { name: "Check the columns" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company or person")).toHaveValue("name");
    expect(screen.getByLabelText("Phone")).toHaveValue("phone");
    expect(screen.getByLabelText("Email")).toHaveValue("email");
    expect(screen.getByLabelText("Source")).toHaveValue("source");
    expect(screen.getByLabelText("Service")).toHaveValue("service");
    await user.click(screen.getByRole("button", { name: /Import 3 rows/ }));
    expect(await screen.findByText("1 of 3 rows imported.")).toBeInTheDocument();
    expect(screen.getByText("2 rows need a look before they can come in.")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Rows that need a look" });
    expect(within(list).getByText("Possible duplicate of Twiga Foods. Skipped.")).toBeInTheDocument();
    expect(within(list).getByText("Row 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download error report/ })).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
    // The default status was added as a column, so a file without one still imports.
    const form = (calls.find((c) => c.id === "postLeadsImport")!.args as { body: FormData }).body;
    expect(JSON.parse(String(form.get("mapping")))).toMatchObject({ company: "name", leadStatus: "__status" });
    expect(form.get("duplicateStrategy")).toBe("skip");
  });

  it("sends a large file in batches, shows progress, and adds the batch offset to row numbers in the report", async () => {
    const user = userEvent.setup();
    const rowsText = ["name,email", ...Array.from({ length: 1100 }, (_, i) => `Co ${i},c${i}@x.example`)].join("\n");
    let n = 0;
    renderScreen(<ImportWizard onClose={() => undefined} onDone={() => undefined} />, {
      keys: SALES_KEYS,
      handlers: {
        postLeadsImport: () => {
          n += 1;
          return { totalRows: n < 3 ? 500 : 100, created: n < 3 ? 500 : 100, duplicatesSkipped: 0, alreadyConverted: 0, failed: n === 2 ? 1 : 0, truncated: false, cancelled: false, errors: n === 2 ? [{ row: 7, reason: "Bad row", outcome: "failed" }] : [] };
        },
      },
    });
    await user.upload(screen.getByLabelText("CSV file"), upload(rowsText));
    await user.click(await screen.findByRole("button", { name: /Import 1100 rows/ }));
    expect(await screen.findByText("1100 of 1100 rows imported.")).toBeInTheDocument();
    expect(n).toBe(3);
    expect(screen.getByText("Row 507")).toBeInTheDocument(); // row 7 of the second batch of 500
  });

  it("says plainly when the file cannot be read, and offers another", async () => {
    const user = userEvent.setup();
    renderScreen(<ImportWizard onClose={() => undefined} onDone={() => undefined} />, { keys: SALES_KEYS });
    await user.upload(screen.getByLabelText("CSV file"), upload("just one line with no table"));
    expect(await screen.findByText("We couldn’t read that file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    renderScreen(<ImportWizard onClose={() => undefined} onDone={() => undefined} />, { keys: SALES_KEYS });
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
  });
});

describe("Export CSV", () => {
  it("downloads at once when it is small", async () => {
    const create = vi.fn(() => "blob:x");
    const url = globalThis.URL as unknown as { createObjectURL: unknown; revokeObjectURL: unknown };
    const prev = [url.createObjectURL, url.revokeObjectURL];
    url.createObjectURL = create;
    url.revokeObjectURL = vi.fn();
    const onClose = vi.fn();
    const { calls } = renderScreen(<ExportDialog total={120} filters={{ q: "wafula" }} onClose={onClose} />, { keys: MGMT_KEYS, roleName: "Management", handlers: { getLeadsExport: "name\nWafula" } });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(create).toHaveBeenCalled();
    expect(calls.find((c) => c.id === "getLeadsExport")?.args).toMatchObject({ query: { q: "wafula" } });
    [url.createObjectURL, url.revokeObjectURL] = prev;
  });

  it("over 500 rows a person without the bulk right is routed to an approval, and sees its status", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<ExportDialog total={2000} filters={{}} onClose={() => undefined} />, { keys: SALES_KEYS.concat("leads.export"), handlers: { requestExportApproval: {}, listExportApprovals: page([]) } });
    expect(await screen.findByRole("heading", { name: "This export needs approval" })).toBeInTheDocument();
    expect(screen.getByText(/more than 500 leads need Management's approval\. This one has 2000/i)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Why do you need it/ }), "Board review");
    await user.click(screen.getByRole("button", { name: "Ask for approval" }));
    expect(calls.find((c) => c.id === "requestExportApproval")?.args).toMatchObject({ body: { entity: "LEAD", reason: "Board review" } });
  });

  it("shows a pending request as waiting for Management, not as an error", async () => {
    renderScreen(<ExportDialog total={2000} filters={{}} onClose={() => undefined} />, {
      keys: SALES_KEYS.concat("leads.export"),
      handlers: { listExportApprovals: page([{ id: "ap1", entity: "LEAD", status: "PENDING", reason: "Board review" }]) },
    });
    expect(await screen.findByText("Waiting for Management")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask for approval" })).toBeNull();
  });

  it("Management starts a large export in the background", async () => {
    const user = userEvent.setup();
    renderScreen(<ExportDialog total={2000} filters={{}} onClose={() => undefined} />, {
      keys: MGMT_KEYS,
      roleName: "Management",
      handlers: { startExport: { id: "run-1", status: "QUEUED", totalRows: 2000 } },
    });
    await user.click(await screen.findByRole("button", { name: "Start export" }));
    expect(await screen.findByText("Your export is running.")).toBeInTheDocument();
  });
});
