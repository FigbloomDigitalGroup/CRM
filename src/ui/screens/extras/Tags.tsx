"use client";

import { useMemo, useState } from "react";
import { useToast } from "../../components/toast";
import { describeError } from "../../errors";
import { useMember } from "../../data/member";
import { Icon } from "../leads/icons";
import { useDeferred, useExtras, useRecordRead } from "./hooks";
import { Unavailable } from "./Unavailable";
import type { ExtrasKind } from "./RecordExtras";

interface TagRow {
  id: string;
  name: string;
  colour: string;
}

const TONES: Record<string, [string, string]> = {
  forest: ["var(--primary-soft)", "var(--primary-text)"],
  mint: ["var(--primary-soft)", "var(--primary-text)"],
  ocean: ["var(--blue-soft)", "var(--blue)"],
  sun: ["var(--orange-soft)", "var(--orange-text)"],
  clay: ["var(--orange-soft)", "var(--orange-text)"],
  berry: ["var(--red-soft)", "var(--red)"],
  plum: ["var(--purple-soft)", "var(--purple)"],
  slate: ["var(--surface-3)", "var(--text-2)"],
};

export function tagTone(colour: string): [string, string] {
  if (TONES[colour]) return TONES[colour]!;
  if (/^#[0-9a-fA-F]{6}$/.test(colour)) return [`color-mix(in srgb, ${colour} 16%, var(--surface))`, `color-mix(in srgb, ${colour} 75%, var(--text))`];
  return TONES.slate!;
}

const NEW = "__new__";

/** Tags (X1): the record's tags, remove with Undo, add from the organisation's tags, or create one when your role manages tags. */
export function TagsSection({ kind, id, archived }: { kind: ExtrasKind; id: string; archived: boolean }) {
  const member = useMember();
  const { ops, params, call, refresh } = useExtras(kind, id);
  const toast = useToast();
  const defer = useDeferred();
  const mine = useRecordRead<{ tags: TagRow[] }>(ops.tags, params);
  const all = useRecordRead<{ items: TagRow[] }>("getTags", { orgSlug: member.orgSlug });
  const [hidden, setHidden] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const tags = useMemo(() => (mine.data?.tags ?? []).filter((t) => !hidden.includes(t.id)), [mine.data, hidden]);
  const options = useMemo(() => (all.data?.items ?? []).filter((t) => !tags.some((x) => x.id === t.id)), [all.data, tags]);
  const canEdit = !archived;

  async function change(body: Record<string, string[]>, failure: string) {
    setBusy(true);
    try {
      await call(ops.changeTags, { body });
      await refresh(ops.tags, ops.record);
      return true;
    } catch (error) {
      toast.show({ tone: "danger", message: `${failure} ${describeError(error).body}` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function remove(tag: TagRow) {
    setHidden((h) => [...h, tag.id]);
    defer({
      key: `tag:${tag.id}`,
      message: `Removed the tag “${tag.name}”.`,
      commit: async () => {
        await call(ops.changeTags, { body: { removeTagIds: [tag.id] } });
        await refresh(ops.tags, ops.record);
        setHidden((h) => h.filter((x) => x !== tag.id));
      },
      onUndo: () => setHidden((h) => h.filter((x) => x !== tag.id)),
      onFail: (message) => {
        setHidden((h) => h.filter((x) => x !== tag.id));
        toast.show({ tone: "danger", message: `The tag was not removed. ${message}` });
      },
    });
  }

  async function createTag() {
    const n = name.trim();
    if (!n) return;
    if (await change({ addTagNames: [n] }, "The tag was not added.")) {
      setName("");
      setCreating(false);
      void refresh("getTags");
    }
  }

  return (
    <section className="fb-xsec" aria-labelledby={`xtags-${id}`}>
      <div className="fb-xsec__head">
        <h2 id={`xtags-${id}`} className="fb-xsec__title"><Icon name="tag" size={16} />Tags</h2>
      </div>
      {mine.isError ? (
        <Unavailable what="Tags" error={mine.error} noun={ops.noun} />
      ) : (
        <>
          <div className="fb-xtags">
            {tags.map((t) => {
              const [bg, fg] = tagTone(t.colour);
              return (
                <span key={t.id} className="fb-xtag" style={{ background: bg, color: fg }}>
                  {t.name}
                  {canEdit ? (
                    <button type="button" className="fb-xtag__x" style={{ color: fg }} aria-label={`Remove tag ${t.name}`} onClick={() => remove(t)}>
                      <Icon name="x" size={11} />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {!mine.isLoading && tags.length === 0 ? <span className="fb-xmuted">No tags yet.</span> : null}
          </div>
          {canEdit && !creating ? (
            <select
              className="fb-xselect"
              aria-label="Add tag"
              value=""
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                if (v === NEW) setCreating(true);
                else if (v) void change({ addTagIds: [v] }, "The tag was not added.");
              }}
            >
              <option value="">+ Add tag…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
              {member.can("tags.manage") ? <option value={NEW}>Create a new tag…</option> : null}
            </select>
          ) : null}
          {canEdit && creating ? (
            <form
              className="fb-xrow"
              onSubmit={(e) => {
                e.preventDefault();
                void createTag();
              }}
            >
              <input className="fb-xinput" aria-label="New tag name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Tag name" />
              <button type="submit" className="fb-xbtn fb-xbtn--primary" disabled={busy || !name.trim()}>Add</button>
              <button type="button" className="fb-xbtn" onClick={() => { setCreating(false); setName(""); }}>Cancel</button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
