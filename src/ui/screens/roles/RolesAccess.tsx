"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, ConfirmDialog, EmptyState, FormErrorSummary, Input, LoadingState, Select, describeError, useApi, useApiQuery, useMember, useToast } from "@/ui";
import { buildNav } from "../../shell/navigation";
import { QueryFailure } from "../../featureUnavailable";
import { Panel } from "../settings/kit";
import { useArchiveRole, useCreateRole, useRoleCatalog, useRoles, useUpdateRole } from "./api";
import {
  ROLE_TEMPLATES,
  activeCount,
  areaNames,
  groupPermissions,
  grantAllKeys,
  keysFromStartingPoint,
  keysFromTemplate,
  sameKeys,
  validateRoleDraft,
  whoCan,
  capabilityMatrix,
  type RoleCatalog,
  type RolePreview,
  type RoleView,
} from "./model";

/**
 * Roles & access (UC-C5, UC-C6) on the real roles API, laid out as a role list on the left and one role's editor on the right:
 * the five standard roles (read-only) and this organisation's own roles with their people counts, New role, Grant all and Revoke all;
 * on the right the name and description, search, a category filter and Copy from, the pages the role opens, a collapsible
 * "Preview as this role", who holds the role, and the permissions as cards grouped by area with an "n / m Active" count.
 * Management only (`roles.manage`); the API checks it again. Nothing here changes what a role may do beyond what the API allows:
 * platform roles stay fixed and reserved permissions stay off with the API's reason.
 */

const NEW = "new";

export function RolesAccess() {
  const { orgSlug, can } = useMember();
  const roles = useRoles(orgSlug);
  const catalog = useRoleCatalog(orgSlug);
  const [selected, setSelected] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<RoleView | null>(null);
  const archive = useArchiveRole();
  const toast = useToast();
  const mayManage = can("roles.manage");

  if (roles.isLoading || catalog.isLoading) return <LoadingState label="Loading roles" />;
  if (roles.error || !roles.data) return <QueryFailure error={roles.error} area="Roles & access" onRetry={() => void roles.refetch()} />;
  if (catalog.error || !catalog.data) return <QueryFailure error={catalog.error} area="Roles & access" onRetry={() => void catalog.refetch()} />;

  const list = roles.data;
  const cat = catalog.data;
  const standard = list.roles.filter((r) => r.kind === "platform");
  const own = list.roles.filter((r) => r.kind === "custom");
  const atLimit = list.limits.customRoles >= list.limits.maxCustomRoles;
  const current = selected === NEW ? NEW : (list.roles.find((r) => r.id === selected)?.id ?? list.roles[0]?.id ?? NEW);
  const role = current === NEW ? undefined : list.roles.find((r) => r.id === current);

  return (
    <>
      <Panel title="Roles & access" description="Who can do what in this organisation. Change a standard role and it is saved as a role of your own, based on the standard one; the standard roles themselves stay the same everywhere.">
        <div className="fb-rl-shell">
          <nav className="fb-rl-rail" aria-label="Roles">
            <RoleGroup title="Standard roles" roles={standard} current={current} onPick={setSelected} />
            <RoleGroup title="Your roles" roles={own} current={current} onPick={setSelected} empty="No roles of your own yet." />
            <Button
              variant="secondary"
              className="fb-rl-new"
              disabledReason={!mayManage ? "Only Management manages roles" : atLimit ? `An organisation has at most ${list.limits.maxCustomRoles} custom roles` : undefined}
              aria-current={current === NEW ? "true" : undefined}
              onClick={() => setSelected(NEW)}
            >
              + New role
            </Button>
          </nav>

          <div className="fb-rl-main">
            <RoleEditor
              key={current}
              catalog={cat}
              roles={list.roles}
              role={role}
              mayManage={mayManage}
              atLimit={atLimit}
              onSaved={(id) => setSelected(id)}
              onArchive={() => role && setArchiving(role)}
            />
          </div>
        </div>
      </Panel>

      <MembersByCapability roles={list.roles} catalog={cat} />

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.name ?? "role"}?`}
        body="Archived roles can no longer be given to people. Nobody holds this one, so nothing changes for anybody."
        confirmLabel="Archive role"
        onConfirm={async () => {
          if (!archiving) return;
          try {
            await archive.mutateAsync({ params: { orgSlug, roleId: archiving.id } });
            toast.show({ message: `${archiving.name} archived`, tone: "success" });
            if (current === archiving.id) setSelected(null);
          } catch (err) {
            toast.show({ message: describeError(err).body, tone: "danger" });
          }
          setArchiving(null);
        }}
      />
    </>
  );
}

function RoleGroup({ title, roles, current, onPick, empty }: { title: string; roles: RoleView[]; current: string; onPick: (id: string) => void; empty?: string }) {
  return (
    <div className="fb-rl-railgroup">
      <div className="fb-rl-railtitle">{title}</div>
      {roles.length === 0 && empty ? <p className="fb-set-muted">{empty}</p> : null}
      <ul className="fb-rl-roles">
        {roles.map((r) => (
          <li key={r.id}>
            <button type="button" className="fb-rl-roleitem" aria-current={r.id === current ? "true" : undefined} onClick={() => onPick(r.id)}>
              <span>{r.name}</span>
              <span className="fb-rl-count" aria-label={`${r.memberCount} ${r.memberCount === 1 ? "person" : "people"}`}>{r.memberCount}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleEditor({ catalog, roles, role, mayManage, atLimit, onSaved, onArchive }: { catalog: RoleCatalog; roles: RoleView[]; role: RoleView | undefined; mayManage: boolean; atLimit: boolean; onSaved: (id: string) => void; onArchive: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const create = useCreateRole();
  const update = useUpdateRole();
  const qc = useQueryClient();
  const creating = !role;
  // A standard role is shared by every organisation, so changing it saves a role of this organisation's own, based on it (Management itself
  // stays fixed: it holds the reserved admin permissions a custom role cannot carry).
  const fromStandard = role?.kind === "platform" && role.key !== "MANAGEMENT" && mayManage;
  const readOnly = !mayManage || (role ? (role.kind === "platform" ? !fromStandard : !role.editable) : false);
  const startKeys = useMemo(() => (fromStandard ? keysFromStartingPoint(role, catalog) : (role?.permissionKeys ?? [])), [fromStandard, role, catalog]);
  const holdersQuery = useApiQuery("getMemberships", { params: { orgSlug } } as never, { enabled: fromStandard } as never) as unknown as {
    data?: Array<{ membershipId: string; roleKey: string; state: string; userName: string }>;
  };
  const holders = fromStandard ? (holdersQuery.data ?? []).filter((m) => m.roleKey === role.key && (m.state === "active" || m.state === "invited")) : [];
  const [moveHolders, setMoveHolders] = useState(true);

  const [name, setName] = useState(fromStandard ? `${role.name} (edited)` : (role?.name ?? ""));
  const [description, setDescription] = useState(role?.description ?? "");
  const [basedOn, setBasedOn] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>(startKeys);
  const [dealValue, setDealValue] = useState<string>(role?.fieldRules["deal.value"] ?? "");
  const [filter, setFilter] = useState("");
  const [area, setArea] = useState("");
  const [apiProblems, setApiProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState<RolePreview | null>(null);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);

  const problems = readOnly ? [] : validateRoleDraft(name, description, catalog);
  const dirty = creating ? name.trim() !== "" || keys.length > 0 : fromStandard ? !sameKeys(keys, startKeys) || dealValue !== "" : name.trim() !== role.name || (description.trim() || null) !== (role.description ?? null) || !sameKeys(keys, role.permissionKeys) || dealValue !== (role.fieldRules["deal.value"] ?? "");
  const groups = useMemo(() => groupPermissions(catalog.permissions, filter).filter((g) => !area || g.area === area), [catalog.permissions, filter, area]);
  const dealField = catalog.fields.find((f) => f.id === "deal.value" && f.editable);
  const hasReserved = catalog.permissions.some((p) => !p.grantable);

  // The live answer: the API explains the proposal (or refuses it with the same reasons a save would give).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = (await api.call("previewRole" as never, {
            params: { orgSlug },
            body: { ...(role ? (fromStandard ? { basedOnRoleKey: role.key } : { roleId: role.id }) : {}), permissionKeys: keys, ...(dealValue ? { fieldRules: { "deal.value": dealValue } } : {}) },
          } as never)) as unknown as RolePreview;
          if (!cancelled) {
            setPreview(result);
            setPreviewProblem(null);
          }
        } catch (err) {
          if (!cancelled) {
            setPreview(null);
            setPreviewProblem(describeError(err).body);
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, orgSlug, role, keys, dealValue]);

  const nav = useMemo(() => buildNav({ permissionKeys: preview?.permissionKeys ?? keys, membershipId: "preview" }), [preview, keys]);
  const chips = nav.flatMap((s) => s.items.map((i) => i.label));

  const copyFrom = (id: string) => {
    if (!id) return;
    const template = ROLE_TEMPLATES.find((t) => t.id === id);
    if (template) {
      setKeys(keysFromTemplate(template, catalog));
      return;
    }
    const source = roles.find((r) => r.id === id);
    setKeys(keysFromStartingPoint(source, catalog));
    if (creating && source?.kind === "platform") setBasedOn(source.key);
  };
  const toggle = (key: string, on: boolean) => setKeys((cur) => (on ? [...new Set([...cur, key])] : cur.filter((k) => k !== key)));

  async function save() {
    setApiProblems([]);
    try {
      const fieldRules = dealValue ? { "deal.value": dealValue } : undefined;
      if (fromStandard) {
        const made = await create.mutateAsync({
          params: { orgSlug },
          body: { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), basedOnRoleKey: role.key, permissionKeys: keys, ...(fieldRules ? { fieldRules } : {}) },
        });
        let moved = 0;
        if (moveHolders && made?.key) {
          for (const m of holders) {
            await api.call("postMembershipsByMembershipIdRole" as never, { params: { orgSlug, membershipId: m.membershipId }, body: { roleKey: made.key } } as never);
            moved += 1;
          }
          await qc.invalidateQueries({ queryKey: ["getMemberships"] });
          await qc.invalidateQueries({ queryKey: ["listRoles"] });
        }
        toast.show({ message: `${name.trim()} saved${moved ? `, and ${moved} ${moved === 1 ? "person" : "people"} moved to it` : ""}`, tone: "success" });
        if (made?.id) onSaved(made.id);
      } else if (role) {
        await update.mutateAsync({ params: { orgSlug, roleId: role.id }, body: { name: name.trim(), description: description.trim() || null, permissionKeys: keys, ...(fieldRules ? { fieldRules } : {}) } });
        toast.show({ message: `${name.trim()} saved`, tone: "success" });
      } else {
        const made = await create.mutateAsync({
          params: { orgSlug },
          body: { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), ...(basedOn ? { basedOnRoleKey: basedOn } : {}), permissionKeys: keys, ...(fieldRules ? { fieldRules } : {}) },
        });
        toast.show({ message: `${name.trim()} added`, tone: "success" });
        if (made?.id) onSaved(made.id);
      }
    } catch (err) {
      setApiProblems([describeError(err).body]);
    }
  }

  const title = creating ? "New role" : role.name;
  const saving = create.isPending || update.isPending;
  const people = role?.memberCount ?? 0;
  const basedOnName = role?.basedOnRoleKey ? (roles.find((x) => x.key === role.basedOnRoleKey)?.name ?? role.basedOnRoleKey) : basedOn ? (roles.find((x) => x.key === basedOn)?.name ?? basedOn) : null;
  const all = [...problems, ...apiProblems];

  return (
    <div className="fb-rl-editor">
      <section className="fb-rl-card" aria-label="Role details">
        <div className="fb-rl-details">
          <Input label="Name" value={name} readOnly={readOnly} onChange={(e) => setName(e.target.value)} maxLength={catalog.limits.nameLength.max} />
          <Input label="Description" value={description} readOnly={readOnly} onChange={(e) => setDescription(e.target.value)} maxLength={catalog.limits.descriptionMax} />
        </div>
        <div className="fb-rl-detailfoot">
          <p className="fb-set-muted">
            {role?.kind === "platform" ? <Badge>{fromStandard ? "Standard · changes save as your own role" : "Standard, read-only"}</Badge> : creating ? <Badge tone="info">New</Badge> : <Badge tone="info">Custom</Badge>}{" "}
            {basedOnName ? `Based on ${basedOnName} · ` : ""}
            {creating ? "Nobody holds it yet" : `${people} ${people === 1 ? "person has" : "people have"} it`}
          </p>
          <div className="fb-rl-actions">
            {!readOnly ? (
              <Button variant="primary" loading={saving} disabledReason={problems.length ? "Fix the problems below first" : previewProblem ? "The preview shows what to fix" : fromStandard && atLimit ? `An organisation has at most ${catalog.limits.maxCustomRoles} custom roles` : !dirty ? "Nothing has changed" : undefined} onClick={() => void save()}>
                {creating ? "Add role" : fromStandard ? "Save as our own role" : "Save changes"}
              </Button>
            ) : null}
            {role?.kind === "custom" ? (
              <Button variant="ghost" disabledReason={!mayManage ? "Only Management manages roles" : people > 0 ? "People still hold this role. Move them to another role first." : undefined} onClick={onArchive}>
                Archive role
              </Button>
            ) : null}
          </div>
        </div>
        {fromStandard && role ? (
          <>
            <p className="fb-set-muted">{role.name} is the same in every organisation, so your changes are saved as a role of your own, based on it. The standard role stays as it is.</p>
            {holders.length > 0 ? (
              <label className="fb-rl-move">
                <input type="checkbox" checked={moveHolders} onChange={(e) => setMoveHolders(e.target.checked)} /> Move the {holders.length === 1 ? "1 person" : `${holders.length} people`} who {holders.length === 1 ? "has" : "have"} {role.name} to this role ({holders.map((h) => h.userName).join(", ")})
              </label>
            ) : null}
          </>
        ) : readOnly && role ? (
          <p className="fb-set-muted">{role.key === "MANAGEMENT" ? "Management runs the organisation and holds the reserved permissions, so it cannot be changed." : "Standard roles are the same in every organisation and cannot be changed. Pick New role, then Copy from this one, to start your own."}</p>
        ) : null}
      </section>

      <div className="fb-rl-toolbar">
        <Input label="Search permissions" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type a word, such as quotes" />
        <Select label="Category" value={area} onChange={(e) => setArea(e.target.value)} options={[{ value: "", label: "All categories" }, ...areaNames(catalog.permissions).map((a) => ({ value: a, label: a }))]} />
        {!readOnly ? (
          <Select
            label="Copy from"
            value=""
            onChange={(e) => copyFrom(e.target.value)}
            options={[
              { value: "", label: "Select a role…" },
              ...roles.filter((r) => r.id !== role?.id).map((r) => ({ value: r.id, label: `${r.name}${r.kind === "platform" ? " (standard)" : ""}` })),
              ...ROLE_TEMPLATES.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        ) : null}
        {!readOnly ? (
          <div className="fb-rl-bulk">
            <Button variant="secondary" onClick={() => setKeys((cur) => grantAllKeys(catalog, cur))}>Grant all</Button>
            <Button variant="danger" onClick={() => setKeys([])}>Revoke all</Button>
          </div>
        ) : null}
      </div>

      <section className="fb-rl-card" aria-label={`What ${title} can do`}>
        <h3 className="fb-set-panel__title">What {title} can do</h3>
        <p className="fb-set-muted">People with this role see these pages in the sidebar. The list follows the switches below.</p>
        {chips.length === 0 ? <p className="fb-set-muted">No pages yet.</p> : (
          <ul className="fb-rl-chips">
            {chips.map((c) => <li key={c} className="fb-rl-chip">{c}</li>)}
          </ul>
        )}
        {hasReserved ? <p className="fb-rl-lock">Reserved permissions, such as the audit log and Settings, stay with the standard roles: whoever holds them could give themselves everything else.</p> : null}
      </section>

      <details className="fb-rl-card fb-rl-preview-box">
        <summary>
          <strong>Preview as this role</strong> <span className="fb-set-muted">{chips.length} pages shown</span>
        </summary>
        <RolePreviewPanel preview={preview} problem={previewProblem} role={role} />
      </details>

      <section className="fb-rl-card" aria-label={`Who has ${title}`}>
        <h3 className="fb-set-panel__title">Who has {title} <span className="fb-set-muted">{people} {people === 1 ? "person" : "people"}</span></h3>
        {creating ? (
          <p className="fb-set-muted">Nobody yet. Save the role, then give it to someone on Settings, Members.</p>
        ) : people === 0 ? (
          <p className="fb-set-muted">Nobody has this role yet. Give it to someone on Settings, Members.</p>
        ) : preview && preview.people.names.length ? (
          <p>{preview.people.names.join(", ")}{preview.people.count > preview.people.names.length ? ` and ${preview.people.count - preview.people.names.length} more` : ""}</p>
        ) : (
          <p className="fb-set-muted">{people} {people === 1 ? "person holds" : "people hold"} this role. Change who on Settings, Members.</p>
        )}
      </section>

      {dealField ? (
        <section className="fb-rl-card" aria-label={dealField.label}>
          <Select
            label={dealField.label}
            help={dealField.help}
            value={dealValue}
            disabled={readOnly}
            onChange={(e) => setDealValue(e.target.value)}
            options={[{ value: "", label: "Standard for this role" }, ...dealField.options.map((o) => ({ value: o, label: o === "all" ? "Everyone with the permission" : o === "own" ? "Only on deals they own" : "Hidden from this role" }))]}
          />
        </section>
      ) : null}

      {groups.map((g) => (
        <fieldset key={g.area} className="fb-rl-card fb-rl-group">
          <legend className="fb-sr-only">{g.area}</legend>
          <div className="fb-rl-grouphead">
            <h3 className="fb-set-panel__title">{g.area}</h3>
            <span className="fb-set-muted">{activeCount(g.permissions, keys)} / {g.permissions.length} Active</span>
          </div>
          <div className="fb-rl-cards">
            {g.permissions.map((p) => {
              const checked = keys.includes(p.key);
              const locked = readOnly || (!p.grantable && !checked);
              const reason = readOnly ? undefined : !p.grantable ? (p.reason ?? "Reserved for the standard roles") : undefined;
              return (
                <label key={p.key} className={`fb-rl-perm${checked ? " is-on" : ""}${locked ? " is-locked" : ""}`} title={reason}>
                  <input type="checkbox" checked={checked} disabled={locked} aria-label={p.key} onChange={(e) => toggle(p.key, e.target.checked)} />
                  <span className="fb-rl-permtext">
                    <code className="fb-rl-key">{p.key}</code>
                    <span className="fb-set-muted">{p.description}{reason ? ` Not available on your own roles: ${reason}` : ""}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      {groups.length === 0 ? <EmptyState title="No permission matches" body="Try a shorter word or another category." /> : null}

      {all.length ? <FormErrorSummary errors={all.map((message, i) => ({ path: `e${i}`, message }))} title="Fix these before saving" /> : null}
    </div>
  );
}

function RolePreviewPanel({ preview, problem, role }: { preview: RolePreview | null; problem: string | null; role: RoleView | undefined }) {
  return (
    <aside className="fb-rl-preview" aria-label="What can this role access?">
      {problem ? (
        <p role="alert" className="fb-rl-problem">{problem}</p>
      ) : !preview ? (
        <p className="fb-set-muted">Working it out…</p>
      ) : (
        <>
          <div>
            <div className="fb-rl-sub">On records</div>
            <ul className="fb-rl-scopes">
              {preview.scopes.map((s) => (
                <li key={`${s.resource}.${s.action}`}>
                  {s.resource} {s.action}: <strong>{s.scope === "organisation" ? "everyone's" : s.scope === "own" ? "own only" : s.scope === "read-only" ? "read only" : "no access"}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="fb-rl-sub">Fields</div>
            <ul className="fb-rl-scopes">
              {preview.fields.map((f) => (
                <li key={f.id}>{f.label}: <strong>{f.access === "all" ? "visible to everyone with the permission" : f.access === "own" ? "visible on own deals" : "hidden"}</strong></li>
              ))}
            </ul>
          </div>
          {role && (preview.gained.length > 0 || preview.lost.length > 0) ? (
            <div>
              <div className="fb-rl-sub">Compared with saved</div>
              {preview.gained.length ? <p>Gains: {preview.gained.join(", ")}</p> : null}
              {preview.lost.length ? <p>Loses: {preview.lost.join(", ")}</p> : null}
            </div>
          ) : null}
          {preview.warnings.map((w) => <p key={w} className="fb-rl-warning">{w}</p>)}
        </>
      )}
    </aside>
  );
}

function MembersByCapability({ roles, catalog }: { roles: RoleView[]; catalog: RoleCatalog }) {
  const [key, setKey] = useState(catalog.permissions[0]?.key ?? "");
  const matrix = useMemo(() => capabilityMatrix(roles, catalog), [roles, catalog]);
  const who = whoCan(roles, key);
  return (
    <Panel title="Members by capability" description="Who can do what today, across all roles. Read only.">
      <div className="fb-rl-who">
        <Select label="Who can…" value={key} onChange={(e) => setKey(e.target.value)} options={catalog.permissions.map((p) => ({ value: p.key, label: `${p.area}: ${p.key}` }))} />
        <p role="status">
          {who.roles.length === 0 ? <strong>Nobody</strong> : <><strong>{who.people} {who.people === 1 ? "person" : "people"}</strong> through {who.roles.map((r) => r.name).join(", ")}</>}
        </p>
      </div>
      <div className="fb-set-tablewrap">
        <table className="fb-com-table">
          <caption className="fb-sr-only">Permissions held per role, by area</caption>
          <thead>
            <tr>
              <th scope="col">Area</th>
              {roles.map((r) => <th key={r.id} scope="col">{r.name} <span className="fb-set-muted">({r.memberCount})</span></th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.area}>
                <th scope="row">{row.area}</th>
                {roles.map((r) => <td key={r.id}>{row.held[r.id] ? `${row.held[r.id]} of ${row.total}` : "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
