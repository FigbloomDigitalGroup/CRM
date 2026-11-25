"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, ConfirmDialog, EmptyState, FormErrorSummary, Input, LoadingState, Select, Textarea, describeError, useApi, useMember, useToast } from "@/ui";
import { buildNav } from "../../shell/navigation";
import { QueryFailure } from "../../featureUnavailable";
import { Panel, Switch } from "../settings/kit";
import { useArchiveRole, useCreateRole, useRoleCatalog, useRoles, useUpdateRole } from "./api";
import {
  ROLE_TEMPLATES,
  groupPermissions,
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
 * Roles & access (UC-C5, UC-C6) on the real roles API: the platform roles (read-only) and this organisation's custom roles, an Add role flow that
 * starts from a platform role or a starter template, the permission switches grouped by area (reserved keys disabled with the API's reason), the
 * "What can this role access?" preview (the API's `roles/preview` plus the sidebar the shell would draw for that key set, from the same `buildNav`),
 * and a members-by-capability view built from the real role list. Management only (`roles.manage`); the API checks it again and gates the
 * routes by the V2 release flag. Nothing here changes what a role may do beyond what the API already allows; platform roles stay fixed.
 */

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; roleId: string };

export function RolesAccess() {
  const { orgSlug, can } = useMember();
  const roles = useRoles(orgSlug);
  const catalog = useRoleCatalog(orgSlug);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [archiving, setArchiving] = useState<RoleView | null>(null);
  const archive = useArchiveRole();
  const toast = useToast();
  const mayManage = can("roles.manage");

  if (roles.isLoading || catalog.isLoading) return <LoadingState label="Loading roles" />;
  if (roles.error || !roles.data) return <QueryFailure error={roles.error} area="Roles & access" onRetry={() => void roles.refetch()} />;
  if (catalog.error || !catalog.data) return <QueryFailure error={catalog.error} area="Roles & access" onRetry={() => void catalog.refetch()} />;

  const list = roles.data;
  const cat = catalog.data;
  const editing = mode.kind === "edit" ? list.roles.find((r) => r.id === mode.roleId) : undefined;
  const atLimit = list.limits.customRoles >= list.limits.maxCustomRoles;

  return (
    <>
      <Panel
        title="Roles & access"
        description="Who can do what in this organisation. The five standard roles are fixed; add your own for any other mix of access."
        actions={
          <Button variant="primary" disabledReason={!mayManage ? "Only Management manages roles" : atLimit ? `An organisation has at most ${list.limits.maxCustomRoles} custom roles` : undefined} onClick={() => setMode({ kind: "new" })}>
            Add role
          </Button>
        }
      >
        <div className="fb-set-tablewrap">
          <table className="fb-com-table">
            <caption className="fb-sr-only">Roles</caption>
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Type</th>
                <th scope="col">Based on</th>
                <th scope="col">People</th>
                <th scope="col">Permissions</th>
                <th scope="col"><span className="fb-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.roles.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <div className="fb-com-strong">{r.name}</div>
                    {r.description ? <div className="fb-set-muted">{r.description}</div> : null}
                  </th>
                  <td>{r.kind === "platform" ? <Badge>Standard, read-only</Badge> : <Badge tone="info">Custom</Badge>}</td>
                  <td>{r.basedOnRoleKey ? (list.roles.find((x) => x.key === r.basedOnRoleKey)?.name ?? r.basedOnRoleKey) : "—"}</td>
                  <td>{r.memberCount}</td>
                  <td>{r.permissionKeys.length}</td>
                  <td>
                    <div className="fb-rl-actions">
                      <Button variant="ghost" onClick={() => setMode({ kind: "edit", roleId: r.id })}>{r.editable && mayManage ? "Edit" : "View"}</Button>
                      {r.kind === "custom" ? (
                        <Button
                          variant="ghost"
                          disabledReason={!mayManage ? "Only Management manages roles" : r.memberCount > 0 ? "People still hold this role. Move them to another role first." : undefined}
                          onClick={() => setArchiving(r)}
                        >
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.roles.every((r) => r.kind === "platform") ? <p className="fb-set-muted">No custom roles yet. Add one based on a standard role.</p> : null}
      </Panel>

      {mode.kind !== "list" ? (
        <RoleEditor
          key={mode.kind === "new" ? "new" : mode.roleId}
          catalog={cat}
          roles={list.roles}
          role={editing}
          mayManage={mayManage}
          onClose={() => setMode({ kind: "list" })}
        />
      ) : null}

      <MembersByCapability roles={list.roles} catalog={cat} />

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.name ?? "role"}?`}
        body="Archived roles can no longer be given to people. Nobody holds this one, so nothing changes for anybody."
        confirmLabel="Archive"
        onConfirm={async () => {
          if (!archiving) return;
          try {
            await archive.mutateAsync({ params: { orgSlug, roleId: archiving.id } });
            toast.show({ message: `${archiving.name} archived`, tone: "success" });
            if (mode.kind === "edit" && mode.roleId === archiving.id) setMode({ kind: "list" });
          } catch (err) {
            toast.show({ message: describeError(err).body, tone: "danger" });
          }
          setArchiving(null);
        }}
      />
    </>
  );
}

const START_BLANK = "blank";

function RoleEditor({ catalog, roles, role, mayManage, onClose }: { catalog: RoleCatalog; roles: RoleView[]; role: RoleView | undefined; mayManage: boolean; onClose: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const create = useCreateRole();
  const update = useUpdateRole();
  const creating = !role;
  const readOnly = !mayManage || (role ? !role.editable : false);

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [start, setStart] = useState(START_BLANK);
  const [keys, setKeys] = useState<string[]>(role?.permissionKeys ?? []);
  const [dealValue, setDealValue] = useState<string>(role?.fieldRules["deal.value"] ?? "");
  const [filter, setFilter] = useState("");
  const [apiProblems, setApiProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState<RolePreview | null>(null);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);

  const problems = readOnly ? [] : validateRoleDraft(name, description, catalog);
  const dirty = creating ? true : name.trim() !== role.name || (description.trim() || null) !== (role.description ?? null) || !sameKeys(keys, role.permissionKeys) || dealValue !== (role.fieldRules["deal.value"] ?? "");
  const groups = useMemo(() => groupPermissions(catalog.permissions, filter), [catalog.permissions, filter]);
  const dealField = catalog.fields.find((f) => f.id === "deal.value" && f.editable);

  // The live "What can this role access?" answer: the API explains the proposal (or refuses it with the same reasons a save would give).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = (await api.call("previewRole" as never, {
            params: { orgSlug },
            body: { ...(role ? { roleId: role.id } : {}), permissionKeys: keys, ...(dealValue ? { fieldRules: { "deal.value": dealValue } } : {}) },
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

  const setStartingPoint = (id: string) => {
    setStart(id);
    if (id === START_BLANK) setKeys([]);
    else if (ROLE_TEMPLATES.some((t) => t.id === id)) setKeys(keysFromTemplate(ROLE_TEMPLATES.find((t) => t.id === id)!, catalog));
    else setKeys(keysFromStartingPoint(roles.find((r) => r.key === id), catalog));
  };
  const toggle = (key: string, on: boolean) => setKeys((cur) => (on ? [...new Set([...cur, key])] : cur.filter((k) => k !== key)));

  async function save() {
    setApiProblems([]);
    try {
      const fieldRules = dealValue ? { "deal.value": dealValue } : undefined;
      if (role) {
        await update.mutateAsync({ params: { orgSlug, roleId: role.id }, body: { name: name.trim(), description: description.trim() || null, permissionKeys: keys, ...(fieldRules ? { fieldRules } : {}) } });
        toast.show({ message: `${name.trim()} saved`, tone: "success" });
      } else {
        const platform = roles.find((r) => r.key === start && r.kind === "platform");
        await create.mutateAsync({
          params: { orgSlug },
          body: { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), ...(platform ? { basedOnRoleKey: platform.key } : {}), permissionKeys: keys, ...(fieldRules ? { fieldRules } : {}) },
        });
        toast.show({ message: `${name.trim()} added`, tone: "success" });
      }
      onClose();
    } catch (err) {
      const d = describeError(err);
      setApiProblems([d.body]);
    }
  }

  const title = creating ? "Add role" : role.editable ? `Edit ${role.name}` : `${role.name} (standard role)`;
  const saving = create.isPending || update.isPending;

  return (
    <Panel title={title} description={readOnly && role ? "Standard roles are the same in every organisation and cannot be changed. You can see what they allow, or start a custom role from one." : "Pick a starting point, then switch on what this role needs. The preview shows the effect before you save."} actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="fb-rl-form">
        <Input label="Name" value={name} readOnly={readOnly} onChange={(e) => setName(e.target.value)} maxLength={catalog.limits.nameLength.max} />
        <Textarea label="Description" value={description} readOnly={readOnly} onChange={(e) => setDescription(e.target.value)} rows={2} />
        {creating ? (
          <Select
            label="Start from"
            help="Copies that role's permissions; you then change what you need."
            value={start}
            onChange={(e) => setStartingPoint(e.target.value)}
            options={[
              { value: START_BLANK, label: "Blank: nothing switched on" },
              ...catalog.startingPoints.map((s) => ({ value: s.key, label: `${s.name} (standard role)` })),
              ...ROLE_TEMPLATES.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        ) : null}
        {creating && ROLE_TEMPLATES.some((t) => t.id === start) ? <p className="fb-set-muted">{ROLE_TEMPLATES.find((t) => t.id === start)!.description}</p> : null}
        {dealField ? (
          <Select
            label={dealField.label}
            help={dealField.help}
            value={dealValue}
            disabled={readOnly}
            onChange={(e) => setDealValue(e.target.value)}
            options={[{ value: "", label: "Standard for this role" }, ...dealField.options.map((o) => ({ value: o, label: o === "all" ? "Everyone with the permission" : o === "own" ? "Only on deals they own" : "Hidden from this role" }))]}
          />
        ) : null}
      </div>

      <div className="fb-rl-split">
        <div className="fb-rl-perms">
          <Input label="Find a permission" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type a word, such as quotes" />
          {groups.map((g) => {
            const on = g.permissions.filter((p) => keys.includes(p.key)).length;
            return (
              <fieldset key={g.area} className="fb-rl-group">
                <legend>{g.area} <span className="fb-set-muted">{on} of {g.permissions.length}</span></legend>
                {g.permissions.map((p) => {
                  const locked = readOnly || (!p.grantable && !keys.includes(p.key));
                  return (
                    <div key={p.key} className="fb-rl-perm">
                      <Switch
                        checked={keys.includes(p.key)}
                        label={`${p.key}${p.description ? `: ${p.description}` : ""}`}
                        disabled={locked || (!p.grantable && !readOnly)}
                        disabledReason={readOnly ? undefined : !p.grantable ? (p.reason ?? "Reserved for Management") : undefined}
                        onChange={(next) => toggle(p.key, next)}
                      />
                      <div>
                        <code className="fb-rl-key">{p.key}</code>
                        <div className="fb-set-muted">{p.description}{!p.grantable && !readOnly && p.reason ? ` Not available on a custom role: ${p.reason}` : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
          {groups.length === 0 ? <EmptyState title="No permission matches" body="Try a shorter word." /> : null}
        </div>
        <RolePreviewPanel preview={preview} problem={previewProblem} keys={keys} role={role} />
      </div>

      {[...problems, ...apiProblems].length ? <FormErrorSummary errors={[...problems, ...apiProblems].map((message, i) => ({ path: `e${i}`, message }))} title="Fix these before saving" /> : null}
      {!readOnly ? (
        <div className="fb-set-panel__actions">
          <Button variant="primary" loading={saving} disabledReason={problems.length ? "Fix the problems above first" : previewProblem ? "The preview shows what to fix" : !dirty ? "Nothing has changed" : undefined} onClick={() => void save()}>
            {creating ? "Add role" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      ) : null}
    </Panel>
  );
}

function RolePreviewPanel({ preview, problem, keys, role }: { preview: RolePreview | null; problem: string | null; keys: string[]; role: RoleView | undefined }) {
  const nav = useMemo(() => buildNav({ permissionKeys: preview?.permissionKeys ?? keys, membershipId: "preview" }), [preview, keys]);
  return (
    <aside className="fb-rl-preview" aria-label="What can this role access?">
      <h3 className="fb-set-panel__title">What can this role access?</h3>
      {problem ? (
        <p role="alert" className="fb-rl-problem">{problem}</p>
      ) : !preview ? (
        <p className="fb-set-muted">Working it out…</p>
      ) : (
        <>
          <div>
            <div className="fb-rl-sub">Pages in the sidebar</div>
            {nav.length === 0 ? <p className="fb-set-muted">None.</p> : (
              <ul className="fb-rl-nav">
                {nav.map((s) => (
                  <li key={s.key}><strong>{s.label}</strong>: {s.items.map((i) => i.label).join(", ")}</li>
                ))}
              </ul>
            )}
          </div>
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
          {role ? <p className="fb-set-muted">Reaches {preview.people.count} {preview.people.count === 1 ? "person" : "people"}{preview.people.names.length ? `: ${preview.people.names.join(", ")}` : ""}.</p> : null}
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
