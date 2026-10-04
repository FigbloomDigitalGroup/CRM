"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type CatalogKey =
  | "leadSources"
  | "leadStatuses"
  | "pipelineStages"
  | "lostReasons"
  | "services";

export type CatalogVariant = "plain" | "pipelineStage" | "service";

export interface CatalogEntryRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  usageCount: number;
  probability?: number | null;
  isWon?: boolean;
  isLost?: boolean;
  category?: string | null;
}

interface EditState {
  name: string;
  description: string;
  probability: string;
  isWon: boolean;
  isLost: boolean;
  category: string;
}

function toEditState(entry: CatalogEntryRow): EditState {
  return {
    name: entry.name,
    description: entry.description ?? "",
    probability: entry.probability != null ? String(entry.probability) : "",
    isWon: entry.isWon ?? false,
    isLost: entry.isLost ?? false,
    category: entry.category ?? "",
  };
}

export function CatalogEditor({
  orgSlug,
  catalogKey,
  label,
  entries,
  variant,
}: {
  orgSlug: string;
  catalogKey: CatalogKey;
  label: string;
  entries: CatalogEntryRow[];
  variant: CatalogVariant;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [adding, setAdding] = useState(false);

  const base = `/api/orgs/${orgSlug}/reference-catalogs/${catalogKey}`;

  async function refresh() {
    router.refresh();
  }

  function startEdit(entry: CatalogEntryRow) {
    setEditingId(entry.id);
    setEdit(toEditState(entry));
    setError(null);
  }

  async function saveEdit(id: string) {
    if (!edit) return;
    setBusyId(id);
    setError(null);
    try {
      const name = edit.name.trim();
      if (!name) throw new Error(`${label} name cannot be blank.`);
      const body: Record<string, unknown> = {
        name,
        description: edit.description.trim() || null,
      };
      if (variant === "pipelineStage") {
        body.probability = edit.probability.trim() ? Number(edit.probability) : null;
        body.isWon = edit.isWon;
        body.isLost = edit.isLost;
      }
      if (variant === "service") {
        body.category = edit.category.trim() || null;
      }
      const res = await fetch(`${base}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `Failed to update ${label.toLowerCase()}.`);
      setEditingId(null);
      setEdit(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(entry: CatalogEntryRow) {
    setBusyId(entry.id);
    setError(null);
    try {
      const res = await fetch(`${base}/${entry.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !entry.isActive }),
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
      const body: Record<string, unknown> = {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      };
      if (variant === "service") body.category = newCategory.trim() || undefined;
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `Failed to add ${label.toLowerCase()}.`);
      setNewName("");
      setNewDescription("");
      setNewCategory("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card">
      <strong>{label}</strong>
      {error && <p className="error">{error}</p>}

      {entries.length === 0 ? (
        <p className="who">None configured yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              {variant === "pipelineStage" && <th>Probability</th>}
              {variant === "pipelineStage" && <th>Won / Lost</th>}
              {variant === "service" && <th>Category</th>}
              <th>Status</th>
              <th>In use</th>
              <th>Order</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => {
              const isEditing = editingId === entry.id;
              const busy = busyId === entry.id;
              return (
                <tr key={entry.id}>
                  <td>
                    {isEditing ? (
                      <input
                        value={edit?.name ?? ""}
                        onChange={(e) =>
                          setEdit((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                        }
                      />
                    ) : (
                      entry.name
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        value={edit?.description ?? ""}
                        onChange={(e) =>
                          setEdit((prev) =>
                            prev ? { ...prev, description: e.target.value } : prev,
                          )
                        }
                      />
                    ) : (
                      entry.description ?? "—"
                    )}
                  </td>
                  {variant === "pipelineStage" && (
                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={edit?.probability ?? ""}
                          onChange={(e) =>
                            setEdit((prev) =>
                              prev ? { ...prev, probability: e.target.value } : prev,
                            )
                          }
                        />
                      ) : entry.probability != null ? (
                        `${entry.probability}%`
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  {variant === "pipelineStage" && (
                    <td>
                      {isEditing ? (
                        <label style={{ display: "flex", gap: 8 }}>
                          <span>
                            <input
                              type="checkbox"
                              checked={edit?.isWon ?? false}
                              onChange={(e) =>
                                setEdit((prev) =>
                                  prev ? { ...prev, isWon: e.target.checked } : prev,
                                )
                              }
                            />{" "}
                            Won
                          </span>
                          <span>
                            <input
                              type="checkbox"
                              checked={edit?.isLost ?? false}
                              onChange={(e) =>
                                setEdit((prev) =>
                                  prev ? { ...prev, isLost: e.target.checked } : prev,
                                )
                              }
                            />{" "}
                            Lost
                          </span>
                        </label>
                      ) : (
                        [entry.isWon && "Won", entry.isLost && "Lost"].filter(Boolean).join(", ") ||
                        "—"
                      )}
                    </td>
                  )}
                  {variant === "service" && (
                    <td>
                      {isEditing ? (
                        <input
                          value={edit?.category ?? ""}
                          onChange={(e) =>
                            setEdit((prev) =>
                              prev ? { ...prev, category: e.target.value } : prev,
                            )
                          }
                        />
                      ) : (
                        entry.category ?? "—"
                      )}
                    </td>
                  )}
                  <td>{entry.isActive ? "Active" : <span className="error">Inactive</span>}</td>
                  <td>{entry.usageCount}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      onClick={() => move(entry.id, "up")}
                      aria-label={`Move ${entry.name} up`}
                    >
                      ↑
                    </button>{" "}
                    <button
                      type="button"
                      disabled={busy || index === entries.length - 1}
                      onClick={() => move(entry.id, "down")}
                      aria-label={`Move ${entry.name} down`}
                    >
                      ↓
                    </button>
                  </td>
                  <td>
                    {isEditing ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => saveEdit(entry.id)}>
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
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => startEdit(entry)}>
                          Edit
                        </button>{" "}
                        <button type="button" disabled={busy} onClick={() => toggleActive(entry)}>
                          {busy ? "..." : entry.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3>Add {label.toLowerCase().replace(/s$/, "")}</h3>
      <form className="stack" onSubmit={handleAdd}>
        <label>
          Name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
        </label>
        <label>
          Description
          <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
        </label>
        {variant === "service" && (
          <label>
            Category
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          </label>
        )}
        <button type="submit" disabled={adding || !newName.trim()}>
          {adding ? "Adding..." : "Add"}
        </button>
      </form>
    </div>
  );
}
