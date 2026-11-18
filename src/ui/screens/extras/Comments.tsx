"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useToast } from "../../components/toast";
import { describeError } from "../../errors";
import { newIdempotencyKey } from "../../data/client";
import { initialsOf } from "../../components/basics";
import { useFormatters } from "../leads/data";
import { useDeferred, useExtras, useRecordRead } from "./hooks";
import { Unavailable } from "./Unavailable";
import type { ExtrasKind } from "./RecordExtras";

interface CommentRow {
  id: string;
  authorName: string | null;
  body: string | null;
  deleted: boolean;
  edited: boolean;
  mentions: string[];
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
}
interface Mentionable {
  membershipId: string;
  name: string;
  roleName: string;
}

const MAX = 5000;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The comment text with each mentioned person's `@Name` set apart. */
function withMentions(body: string, names: string[]): ReactNode {
  if (names.length === 0) return body;
  const pattern = new RegExp(`(@(?:${names.map(escape).join("|")}))`, "g");
  return body.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="fb-xmention">{part}</span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Internal comments (X1): plain text, @mentions of people who can open the record, edit and delete your own (Management may delete any). */
export function CommentsSection({ kind, id, archived }: { kind: ExtrasKind; id: string; archived: boolean }) {
  const { ops, params, call, refresh } = useExtras(kind, id);
  const toast = useToast();
  const defer = useDeferred();
  const fmt = useFormatters();
  const q = useRecordRead<{ comments: CommentRow[]; following: boolean }>(ops.comments, params);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);

  const comments = useMemo(() => (q.data?.comments ?? []).filter((c) => !hidden.includes(c.id)), [q.data, hidden]);
  const hint = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  const needsPeople = Boolean(hint) || comments.some((c) => c.mentions.length > 0);
  const people = useRecordRead<{ members: Mentionable[] }>(ops.mentionable, params, { enabled: needsPeople && !q.isError });
  const members = people.data?.members ?? [];
  const nameOf = (membershipId: string) => members.find((m) => m.membershipId === membershipId)?.name;

  const options = hint ? members.filter((m) => m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(hint[1]!.toLowerCase())) || m.name.toLowerCase().startsWith(hint[1]!.toLowerCase())).slice(0, 5) : [];

  function pick(m: Mentionable) {
    setDraft((d) => d.replace(/@[^\s@]*$/, `@${m.name} `));
    setPicked((p) => ({ ...p, [m.name]: m.membershipId }));
  }

  async function post() {
    const text = draft.trim();
    if (!text || posting) return;
    if (text.length > MAX) return void toast.show({ tone: "danger", message: `A comment can be up to ${MAX} characters.` });
    setPosting(true);
    try {
      const mentions = Object.entries(picked).filter(([name]) => text.includes(`@${name}`)).map(([, mid]) => mid);
      await call(ops.addComment, { body: { body: text, mentions }, idempotencyKey: newIdempotencyKey() });
      setDraft("");
      setPicked({});
      await refresh(ops.comments);
      toast.show({ message: "Comment posted." });
    } catch (error) {
      toast.show({ tone: "danger", message: `The comment was not posted. ${describeError(error).body}` });
    } finally {
      setPosting(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    const current = (q.data?.comments ?? []).find((c) => c.id === editing.id);
    try {
      await call("editComment", { params: { orgSlug: params.orgSlug!, commentId: editing.id }, body: { body: text, mentions: current?.mentions ?? [] } });
      setEditing(null);
      await refresh(ops.comments);
    } catch (error) {
      toast.show({ tone: "danger", message: `The comment was not changed. ${describeError(error).body}` });
    }
  }

  function remove(c: CommentRow) {
    setHidden((h) => [...h, c.id]);
    defer({
      key: `comment:${c.id}`,
      message: "Comment deleted.",
      commit: async () => {
        await call("deleteCommentsByCommentId", { params: { orgSlug: params.orgSlug!, commentId: c.id } });
        await refresh(ops.comments);
        setHidden((h) => h.filter((x) => x !== c.id));
      },
      onUndo: () => setHidden((h) => h.filter((x) => x !== c.id)),
      onFail: (message) => {
        setHidden((h) => h.filter((x) => x !== c.id));
        toast.show({ tone: "danger", message: `The comment was not deleted. ${message}` });
      },
    });
  }

  return (
    <section className="fb-xsec fb-xsec--wide" aria-labelledby={`xcom-${id}`}>
      <div className="fb-xsec__head">
        <h2 id={`xcom-${id}`} className="fb-xsec__title">Internal comments</h2>
        <span className="fb-xpill">Internal only · never sent to the customer</span>
      </div>
      {q.isError ? (
        <Unavailable what="Comments" error={q.error} noun={ops.noun} />
      ) : (
        <>
          <div>
            {comments.map((c) => {
              const names = c.mentions.map(nameOf).filter((n): n is string => Boolean(n));
              const author = c.authorName ?? "Team member";
              return (
                <div key={c.id} className="fb-xcomment">
                  <span className="fb-xcomment__av" aria-hidden="true">{initialsOf(author)}</span>
                  <div className="fb-xcomment__main">
                    <div className="fb-xcomment__by">
                      <strong>{author}</strong> <span className="fb-xmuted">· {fmt.when(c.createdAt)}{c.edited && !c.deleted ? " · edited" : ""}</span>
                    </div>
                    {c.deleted ? (
                      <div className="fb-xcomment__text fb-xmuted">This comment was deleted.</div>
                    ) : editing?.id === c.id ? (
                      <form className="fb-xrow" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
                        <input className="fb-xinput" aria-label="Edit your comment" value={editing.text} autoFocus maxLength={MAX} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} />
                        <button type="submit" className="fb-xbtn fb-xbtn--primary fb-xbtn--sm">Save</button>
                        <button type="button" className="fb-xbtn fb-xbtn--sm" onClick={() => setEditing(null)}>Cancel</button>
                      </form>
                    ) : (
                      <div className="fb-xcomment__text">{withMentions(c.body ?? "", names)}</div>
                    )}
                    {!c.deleted && !archived && editing?.id !== c.id && (c.canEdit || c.canDelete) ? (
                      <div className="fb-xcomment__tools">
                        {c.canEdit ? <button type="button" className="fb-xlink" onClick={() => setEditing({ id: c.id, text: c.body ?? "" })}>Edit</button> : null}
                        {c.canDelete ? <button type="button" className="fb-xlink" onClick={() => remove(c)}>Delete</button> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {!q.isLoading && comments.length === 0 ? <p className="fb-xmuted fb-xempty">No comments yet. Start the conversation your team will want to read later.</p> : null}
          </div>
          {archived ? null : (
            <>
              <form className="fb-xcompose" onSubmit={(e) => { e.preventDefault(); void post(); }}>
                <input
                  className="fb-xcompose__input"
                  aria-label="Write a comment"
                  value={draft}
                  maxLength={MAX}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Comment, or @mention a teammate"
                />
                <button type="submit" className="fb-xcompose__post" disabled={posting || !draft.trim()}>Post</button>
              </form>
              {hint && options.length > 0 ? (
                <div className="fb-xmentions" role="group" aria-label="Mention a teammate">
                  {options.map((m) => (
                    <button key={m.membershipId} type="button" className="fb-xmentions__opt" onClick={() => pick(m)}>@{m.name}</button>
                  ))}
                </div>
              ) : null}
              {hint && people.data && options.length === 0 ? <p className="fb-xhint">No one with that name can open this {ops.noun}.</p> : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
