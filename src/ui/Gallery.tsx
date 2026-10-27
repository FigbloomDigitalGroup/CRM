"use client";

import { Archive, Phone, Plus } from "lucide-react";
import { useState } from "react";
import { THEMES } from "@/preferences/catalogue";
import {
  ArchivedBanner,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  ColourField,
  ConfirmDialog,
  DataTable,
  DateField,
  DensitySample,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  HealthChip,
  IconButton,
  Input,
  KanbanCard,
  KpiTile,
  LoadingState,
  MaskedValue,
  Menu,
  NoAccess,
  OfflineBanner,
  OwnerChip,
  Popover,
  ReleaseTag,
  ScopePill,
  ScoreChip,
  SearchableSelect,
  Select,
  SessionTimerBar,
  Skeleton,
  Tabs,
  Tag,
  ThemeCard,
  TimeField,
  Textarea,
  Timeline,
  TimelineItem,
  Tooltip,
  useToast,
  type Column,
} from "@/ui";
import { useAppearance } from "@/ui/theme/ThemeProvider";
import { TEXT_SIZES } from "@/ui/theme/resolve";

/**
 * The component gallery (F1.02): every component in every variant and state on one page, with the switches to see it in light and dark, compact,
 * largest text and at 375 px. Development only (the route refuses to render otherwise). It is also what the axe and overflow checks run against.
 */

interface Row {
  id: string;
  company: string;
  status: string;
  score: number;
  value: number | null;
}
const ROWS: Row[] = [
  { id: "1", company: "Wafula Ltd", status: "Qualified", score: 82, value: 450000 },
  { id: "2", company: "Kamau and Sons", status: "New", score: 41, value: null },
  { id: "3", company: "Njeri Fresh", status: "Contacted", score: 67, value: 120000 },
];

const COLUMNS: Column<Row>[] = [
  { key: "company", header: "Company", cell: (r) => <strong>{r.company}</strong>, sortValue: (r) => r.company, alwaysVisible: true },
  { key: "status", header: "Status", cell: (r) => <Badge tone={r.status === "Qualified" ? "success" : "info"}>{r.status}</Badge>, sortValue: (r) => r.status },
  { key: "score", header: "Score", cell: (r) => <ScoreChip score={r.score} band={r.score >= 75 ? "HOT" : r.score >= 50 ? "WARM" : "COLD"} />, sortValue: (r) => r.score, align: "right" },
  { key: "value", header: "Value", cell: (r) => (r.value === null ? <MaskedValue /> : `KES ${r.value.toLocaleString("en-KE")}`), hiddenByDefault: false },
];

const OWNERS = [
  { value: "m1", label: "Dev Management" },
  { value: "s1", label: "Dev Sales" },
  { value: "s2", label: "Dev Sales Two", hint: "Sales" },
];

export function Gallery() {
  const toast = useToast();
  const appearance = useAppearance();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [owner, setOwner] = useState<string | null>("s1");
  const [theme, setTheme] = useState("FOREST");
  const [colour, setColour] = useState("#1F7A4D");
  const [narrow, setNarrow] = useState(false);
  const [chipOn, setChipOn] = useState(true);

  return (
    <div>
      <div className="fb-card" style={{ marginBottom: 16 }} role="region" aria-label="Gallery controls">
        <div className="fb-gallery__row" style={{ marginTop: 0 }}>
          <Button onClick={appearance.toggleScheme} disabledReason={appearance.locked ? "Your organisation has set the colours." : undefined}>
            {appearance.scheme === "dark" ? "Light" : "Dark"}
          </Button>
          <Button onClick={() => appearance.setDensity(appearance.density === "COMPACT" ? "COMFORTABLE" : "COMPACT")}>
            Density: {appearance.density === "COMPACT" ? "Compact" : "Comfortable"}
          </Button>
          <Select
            label="Text size"
            value={appearance.device.textSize}
            onChange={(e) => appearance.setDevice({ textSize: e.target.value as (typeof TEXT_SIZES)[number] })}
            options={TEXT_SIZES.map((s) => ({ value: s, label: s === "EXTRA_LARGE" ? "Largest" : s.charAt(0) + s.slice(1).toLowerCase() }))}
          />
          <Checkbox label="Bold text" checked={appearance.device.bold} onChange={(e) => appearance.setDevice({ bold: e.target.checked })} />
          <Checkbox label="Higher contrast" checked={appearance.device.higherContrast} onChange={(e) => appearance.setDevice({ higherContrast: e.target.checked })} />
          <Checkbox label="Reduce motion" checked={appearance.device.reduceMotion} onChange={(e) => appearance.setDevice({ reduceMotion: e.target.checked })} />
          <Checkbox label="Status markers" checked={appearance.device.statusMarkers} onChange={(e) => appearance.setDevice({ statusMarkers: e.target.checked })} />
          <Checkbox label="Preview at 375px" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} />
        </div>
      </div>

      <div data-testid="gallery-frame" style={{ width: narrow ? 375 : undefined, maxWidth: "100%", overflow: "hidden" }}>
        <div className="fb-gallery">
          <Card title="Buttons">
            <span className="fb-gallery__code">&lt;Button variant&gt;</span>
            <div className="fb-gallery__row">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="link">Link</Button>
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary" loading>Saving</Button>
              <Button variant="primary" disabledReason="Only Management can change this.">Disabled with reason</Button>
              <IconButton label="Add"><Plus size={16} /></IconButton>
            </div>
          </Card>

          <Card title="Fields">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input label="Company" required placeholder="Type a name" help="As on the invoice." />
              <Input label="Email" type="email" defaultValue="not-an-email" error="Enter a valid email address." />
              <Textarea label="Notes" />
              <Select label="Source" placeholder="Choose a source" options={[{ value: "web", label: "Website" }, { value: "ref", label: "Referral" }]} />
              <SearchableSelect label="Owner" options={OWNERS} value={owner} onChange={setOwner} />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <DateField label="Follow-up date" />
                <TimeField label="Time" />
              </div>
              <Input label="Locked field" disabledReason="Only Management can change this." defaultValue="Figbloom" />
              <Checkbox label="Send a confirmation email" />
            </div>
          </Card>

          <Card title="Badges, scope pills, owners">
            <span className="fb-gallery__code">&lt;Badge tone&gt; &lt;ScopePill scope&gt; &lt;OwnerChip&gt;</span>
            <div className="fb-gallery__row">
              <Badge tone="neutral">Draft</Badge>
              <Badge tone="info">New</Badge>
              <Badge tone="success">Qualified</Badge>
              <Badge tone="warning">Overdue · 3 Oct</Badge>
              <Badge tone="danger">Lost</Badge>
              <Badge tone="purple">Needs identified</Badge>
              <ReleaseTag release="v1" />
              <ReleaseTag release="v1.1" />
            </div>
            <div className="fb-gallery__row">
              <ScopePill scope="organisation" />
              <ScopePill scope="team" />
              <ScopePill scope="mine" />
              <ScopePill scope="read-only" />
            </div>
            <div className="fb-gallery__row">
              <OwnerChip name="Dev Sales Two" />
              <OwnerChip name={null} />
              <Avatar name="Given Jim" />
              <ScoreChip score={82} band="HOT" />
              <HealthChip health="AT_RISK" />
              <Chip selected={chipOn} onToggle={() => setChipOn((v) => !v)}>Filter chip</Chip>
              <Tag onRemove={() => undefined}>Priority</Tag>
            </div>
          </Card>

          <Card title="KPI tile, kanban card, timeline">
            <div className="fb-gallery__row" style={{ justifyContent: "space-between" }}>
              <KpiTile label="Open deals" value="24" trend="3 this week" tone="up" />
              <KpiTile label="Overdue tasks" value="5" trend="2 more than last week" tone="down" />
            </div>
            <div style={{ marginTop: 12 }}>
              <KanbanCard title="Wafula Ltd" subtitle="Website redesign" badges={<Badge tone="success">Qualified</Badge>} footer={<OwnerChip name="Dev Sales" />} />
            </div>
            <Timeline>
              <TimelineItem icon={<Phone size={16} />} title="Call with Wafula: 210 units, 188 occupied." meta="Dev Sales Two · 16 Oct · Interested" />
              <TimelineItem icon={<Archive size={16} />} title="Archived by Management." meta="17 Oct" />
            </Timeline>
          </Card>

          <Card title="Tabs">
            <Tabs
              label="Gallery tabs"
              tabs={[
                { id: "a", label: "Overview", panel: <p>The overview panel.</p> },
                { id: "b", label: "Activity", panel: <p>The activity panel.</p> },
                { id: "c", label: "Payments", panel: null, disabledReason: "Payments are visible to Finance and Management only." },
              ]}
            />
          </Card>

          <Card title="Menus, popovers, tooltips, dialogs, drawers, toasts">
            <div className="fb-gallery__row">
              <Menu
                label="Row actions"
                trigger="Actions"
                triggerClassName="fb-btn fb-btn--secondary"
                items={[
                  { key: "edit", label: "Edit", onSelect: () => toast.show({ message: "Edit chosen" }) },
                  { key: "assign", label: "Assign", disabledReason: "Only Sales leads can assign." },
                  { key: "archive", label: "Archive", danger: true, separatorBefore: true, onSelect: () => toast.show({ message: "Lead archived.", undo: () => undefined }) },
                ]}
              />
              <Popover label="Filters" trigger="Popover" triggerClassName="fb-btn fb-btn--secondary">
                <p style={{ margin: 8 }}>Any content: filters, a date range, a quick form.</p>
              </Popover>
              <Tooltip text="Tooltips never carry the only copy of anything.">
                <Button>Hover or focus me</Button>
              </Tooltip>
            </div>
            <div className="fb-gallery__row">
              <Button onClick={() => setDialog(true)}>Dialog</Button>
              <Button onClick={() => setConfirm(true)}>Confirm dialog</Button>
              <Button onClick={() => setDrawer(true)}>Drawer</Button>
              <Button onClick={() => toast.show({ message: "Stage moved to Qualified.", undo: () => undefined })}>Undo toast</Button>
              <Button onClick={() => toast.show({ tone: "danger", message: "Could not save. Try again." })}>Error toast</Button>
            </div>
          </Card>

          <Card title="Banners">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Banner tone="warning" title="Possible duplicate.">Warns, never blocks.</Banner>
              <Banner tone="info" title="Heads up.">Your time zone differs from the organisation&apos;s.</Banner>
              <Banner tone="success" title="Saved.">Everything is up to date.</Banner>
              <Banner tone="danger" title="That failed.">Nothing was changed.</Banner>
              <ArchivedBanner what="lead" onRestore={() => undefined} />
              <OfflineBanner queued={2} />
            </div>
          </Card>

          <Card title="Appearance">
            <div className="fb-gallery__row" style={{ marginTop: 0 }}>
              {THEMES.slice(0, 3).map((t) => (
                <ThemeCard key={t.key} theme={t} selected={theme === t.key} onSelect={() => setTheme(t.key)} />
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <ColourField label="Accent colour" value={colour} onChange={setColour} against="#FFFFFF" />
            </div>
            <div style={{ marginTop: 12 }}>
              <DensitySample density="comfortable" />
              <DensitySample density="compact" />
            </div>
            <div style={{ marginTop: 12 }}>
              <SessionTimerBar secondsLeft={540} totalSeconds={28800} />
            </div>
          </Card>
        </div>

        <div style={{ marginTop: 16 }}>
          <Card title="Data table">
            <DataTable
              caption="Sample leads"
              columns={COLUMNS}
              rows={ROWS}
              rowKey={(r) => r.id}
              rowLabel={(r) => r.company}
              selectable
              filterable
              filterLabel="Filter leads"
              rowDisabledReason={(r) => (r.id === "2" ? "Read-only: owned by another team." : undefined)}
              bulkActions={(rows) => <Button size="sm" onClick={() => toast.show({ message: `Assigned ${rows.length}` })}>Assign</Button>}
              empty={<EmptyState title="No leads yet" body="Add your first lead or import a spreadsheet." action={<Button variant="primary">Add a lead</Button>} />}
            />
          </Card>
        </div>

        <div className="fb-gallery" style={{ marginTop: 16 }}>
          <Card title="State: loading"><LoadingState /></Card>
          <Card title="State: empty"><EmptyState title="No leads yet" body="Add your first lead or import a spreadsheet." action={<Button variant="primary">Add a lead</Button>} /></Card>
          <Card title="State: error"><ErrorState error={{ status: 500, envelope: { requestId: "req_8f2a91" } }} onRetry={() => undefined} /></Card>
          <Card title="State: no access"><NoAccess area="Leads" denial={{ yourRole: "Finance", ownerRoles: ["Management", "Sales"], whoToAsk: ["Dev Management"] }} /></Card>
          <Card title="State: masked value">
            <p style={{ margin: 0 }}>Deal value: <MaskedValue reason="Deal values are visible to Management and Sales only." /></p>
          </Card>
          <Card title="State: archived"><ArchivedBanner what="company" /></Card>
          <Card title="State: offline"><OfflineBanner /></Card>
          <Card title="Skeletons">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton width="80%" />
              <Skeleton width="60%" />
              <Skeleton width="90%" height={32} radius={10} />
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={dialog} onClose={() => setDialog(false)} title="Rename view" actions={<Button variant="primary" onClick={() => setDialog(false)}>Save</Button>}>
        <Input label="Name" defaultValue="My leads" />
      </Dialog>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Archive this lead?" body="It moves to the Archived tab and can be restored." confirmLabel="Archive" tone="danger" onConfirm={() => undefined} />
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="New lead" footer={<Button variant="primary" onClick={() => setDrawer(false)}>Create</Button>}>
        <Input label="Name" required />
      </Drawer>
    </div>
  );
}
