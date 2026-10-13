"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AssignmentRuleRow {
  id: string;
  name: string;
  leadSourceId: string | null;
  serviceId: string | null;
  assigneeMembershipId: string | null;
  assigneeMembershipIds: string[];
  isActive: boolean;
}

export interface AssignmentRuleOption {
  id: string;
  name: string;
}

interface EditState {
  name: string;
  leadSourceId: string;
  serviceId: string;
  assigneeMode: "specific" | "group";
  assigneeMembershipId: string;
  assigneeMembershipIds: string[];
}

const EMPTY_EDIT: EditState = {
  name: "",
  leadSourceId: "",
  serviceId: "",
  assigneeMode: "specific",
  assigneeMembershipId: "",
  assigneeMembershipIds: [],
};

function toEditState(rule: AssignmentRuleRow): EditState {
  return {
    name: rule.name,
    leadSourceId: rule.leadSourceId ?? "",
    serviceId: rule.serviceId ?? "",
    assigneeMode: rule.assigneeMembershipIds.length > 0 ? "group" : "specific",
    assigneeMembershipId: rule.assigneeMembershipId ?? "",
    assigneeMembershipIds: rule.assigneeMembershipIds,
  };
}

function nameFor(options: AssignmentRuleOption[], id: string | null): string {
  if (!id) return "Any";
  return options.find((o) => o.id === id)?.name ?? "(removed)";
}

/**
 * Settings screen for FIG-751's per-org website lead assignment rules --
 * same list/add/edit/reorder/disable shape as `CatalogEditor.tsx`, with a
 * rule-specific match (lead source/service) and assignee (a specific rep
 * or a round-robin group) in place of the catalogs' plain name/description.
 */
export function WebsiteLeadAssignmentRulesEditor({
  orgSlug,
  rules,
  leadSources,
  services,
  members,
}: {
  orgSlug: string;
  rules: AssignmentRuleRow[];
  leadSources: AssignmentRuleOption[];
  services: AssignmentRuleOption[];
  members: AssignmentRuleOption[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newRule, setNewRule] = useState<EditState>(EMPTY_EDIT);
  const [adding, setAdding] = useState(false);

  const base = `/api/orgs/${orgSlug}/website-lead-assignment-rules`;

  async function refresh() {
    router.refresh();
  }

  function toBody(state: EditState) {
    return {
      name: state.name.trim(),
      leadSourceId: state.leadSourceId || null,
      serviceId: state.serviceId || null,
      assigneeMembershipId: state.assigneeMode === "specific" ? state.assigneeMembershipId || null : null,
      assigneeMembershipIds: state.assigneeMode === "group" ? state.assigneeMembershipIds : [],
    };
  }

  function startEdit(rule: AssignmentRuleRow) {
    setEditingId(rule.id);
    setEdit(toEditState(rule));
    setError(null);
  }

  async function saveEdit(id: string) {
    if (!edit) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(edit)),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to update rule.");
      setEditingId(null);
      setEdit(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(rule: AssignmentRuleRow) {
    setBusyId(rule.id);
    setError(null);
    try {
      const res = await fetch(`${base}/${rule.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to update status.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusyId(null);
    }
  }

  async function move(id: string, direction: "up" | "down") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to reorder.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(newRule)),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to add rule.");
      setNewRule(EMPTY_EDIT);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add.");
    } finally {
      setAdding(false);
    }
  }

  function AssigneeFields({
    state,
    onChange,
  }: {
    state: EditState;
    onChange: (next: EditState) => void;
  }) {
    return (
      <div className="stack">
        <label style={{ display: "flex", gap: 12 }}>
          <span>
            <input
              type="radio"
              checked={state.assigneeMode === "specific"}
              onChange={() => onChange({ ...state, assigneeMode: "specific" })}
            />{" "}
            Specific rep
          </span>
          <span>
            <input
              type="radio"
              checked={state.assigneeMode === "group"}
              onChange={() => onChange({ ...state, assigneeMode: "group" })}
            />{" "}
            Round-robin group
          </span>
        </label>
        {state.assigneeMode === "specific" ? (
          <select
            value={state.assigneeMembershipId}
            onChange={(e) => onChange({ ...state, assigneeMembershipId: e.target.value })}
          >
            <option value="">Select a member&hellip;</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="stack" style={{ maxHeight: 140, overflowY: "auto" }}>
            {members.map((m) => (
              <label key={m.id} style={{ display: "flex", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={state.assigneeMembershipIds.includes(m.id)}
                  onChange={(e) =>
                    onChange({
                      ...state,
                      assigneeMembershipIds: e.target.checked
                        ? [...state.assigneeMembershipIds, m.id]
                        : state.assigneeMembershipIds.filter((id) => id !== m.id),
                    })
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <strong>Website lead assignment rules</strong>
      <p className="who">
        Checked in order, top to bottom, ahead of the round-robin/unassigned switch above: the
        first active rule whose lead source and/or service matches the incoming lead wins. No
        matching rule (or a matched rule with nobody currently eligible) falls back to that
        switch unchanged.
      </p>
      {error && <p className="error">{error}</p>}

      {rules.length === 0 ? (
        <p className="who">No rules configured yet -- every website lead uses the switch above.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Service</th>
              <th>Assignee</th>
              <th>Status</th>
              <th>Order</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, index) => {
              const isEditing = editingId === rule.id;
              const busy = busyId === rule.id;
              return (
                <tr key={rule.id}>
                  {isEditing && edit ? (
                    <>
                      <td>
                        <input
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          value={edit.leadSourceId}
                          onChange={(e) => setEdit({ ...edit, leadSourceId: e.target.value })}
                        >
                          <option value="">Any</option>
                          {leadSources.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={edit.serviceId}
                          onChange={(e) => setEdit({ ...edit, serviceId: e.target.value })}
                        >
                          <option value="">Any</option>
                          {services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td colSpan={2}>
                        <AssigneeFields state={edit} onChange={setEdit} />
                      </td>
                      <td colSpan={2}>
                        <button type="button" disabled={busy} onClick={() => saveEdit(rule.id)}>
                          {busy ? "Saving..." : "Save"}
                        </button>{" "}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(null);
                            setEdit(null);
                          }}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{rule.name}</td>
                      <td>{nameFor(leadSources, rule.leadSourceId)}</td>
                      <td>{nameFor(services, rule.serviceId)}</td>
                      <td>
                        {rule.assigneeMembershipIds.length > 0
                          ? `Round robin (${rule.assigneeMembershipIds.length} members)`
                          : nameFor(members, rule.assigneeMembershipId)}
                      </td>
                      <td>{rule.isActive ? "Active" : <span className="error">Disabled</span>}</td>
                      <td>
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => move(rule.id, "up")}
                          aria-label={`Move ${rule.name} up`}
                        >
                          ↑
                        </button>{" "}
                        <button
                          type="button"
                          disabled={busy || index === rules.length - 1}
                          onClick={() => move(rule.id, "down")}
                          aria-label={`Move ${rule.name} down`}
                        >
                          ↓
                        </button>
                      </td>
                      <td>
                        <button type="button" onClick={() => startEdit(rule)}>
                          Edit
                        </button>{" "}
                        <button type="button" disabled={busy} onClick={() => toggleActive(rule)}>
                          {busy ? "..." : rule.isActive ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3>Add rule</h3>
      <form className="stack" onSubmit={handleAdd}>
        <label>
          Name
          <input
            value={newRule.name}
            onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
            required
          />
        </label>
        <label>
          Lead source
          <select
            value={newRule.leadSourceId}
            onChange={(e) => setNewRule({ ...newRule, leadSourceId: e.target.value })}
          >
            <option value="">Any</option>
            {leadSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select
            value={newRule.serviceId}
            onChange={(e) => setNewRule({ ...newRule, serviceId: e.target.value })}
          >
            <option value="">Any</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <AssigneeFields state={newRule} onChange={setNewRule} />
        <button type="submit" disabled={adding || !newRule.name.trim()}>
          {adding ? "Adding..." : "Add rule"}
        </button>
      </form>
    </div>
  );
}
