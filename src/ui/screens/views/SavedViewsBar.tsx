"use client";

import { Bookmark, ChevronDown, ChevronUp, Pin, PinOff, Share2, Trash2, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/basics";
import { Dialog } from "../../components/overlays";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { toolsEnabled } from "../assistant/ToolsHost";
import { describeError } from "../../errors";
import { mayEdit, nameProblem, visibleViews, type SavedView, type ViewPage } from "./model";
import { useSavedViews, useViewActions } from "./store";

/** The API's sentence where it is written for people (a taken name, a part this role may not save), the copy deck's otherwise. */
const why = (e: unknown) => {
  const d = describeError(e);
  return d.kind === "validation" || d.kind === "conflict" ? d.body : d.kind === "noAccess" ? "Your role cannot do that. Only the person who made a view can change it." : d.body;
};

export interface ViewState {
  tab: string;
  filters: Record<string, string>;
}

/**
 * Saved views on a list page (X4, FIG-1173): a row of the views this person may see (theirs, and colleagues' shared ones), "Save as view" for what
 * is on screen now, and Manage views: rename, share, pin to the sidebar, reorder, delete. A link from the sidebar arrives as `?savedView=id`,
 * which applies the view once and clears the parameter.
 */
export function SavedViewsBar({ page, current, onApply }: { page: ViewPage; current: ViewState; onApply: (state: ViewState) => void }) {
  const member = useMember();
  const me = { membershipId: member.membershipId, permissionKeys: member.permissionKeys };
  const { views, query } = useSavedViews({ entity: page, enabled: toolsEnabled() });
  const actions = useViewActions();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const wanted = params?.get("savedView") ?? null;
  const [naming, setNaming] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const applied = useRef<string | null>(null);

  const mine = visibleViews(views, me, page);

  useEffect(() => {
    if (!wanted || applied.current === wanted) return;
    const v = views.find((x) => x.id === wanted);
    if (!v) return;
    applied.current = wanted;
    if (visibleViews(views, me, page).some((x) => x.id === wanted)) {
      onApply(v.state);
      toast.show({ message: `Showing the view “${v.name}”.` });
    } else toast.show({ tone: "danger", message: "That view is not available to your role." });
    router.replace(pathname);
  }, [wanted, views]);

  if (!toolsEnabled()) return null;

  const nameError = naming !== null && naming !== "" ? nameProblem(naming, views.filter((v) => v.by === me.membershipId)) : null;

  async function save() {
    if (naming === null) return;
    try {
      await actions.create({ name: naming, page, state: current });
      toast.show({ message: `Saved the view “${naming.trim()}”. Pin it to keep it in your sidebar.` });
      setNaming(null);
    } catch (e) {
      toast.show({ tone: "danger", message: why(e) });
    }
  }

  if (query.error) {
    const d = describeError(query.error);
    // An organisation not on V1.1 has no saved views yet: say so quietly instead of an error banner on every list.
    return (
      <div className="fb-sv" role="group" aria-label="Saved views" data-testid="saved-views-bar">
        <span className="fb-sv__label">
          <Bookmark size={14} aria-hidden="true" /> Views
        </span>
        <span className="fb-sv__empty" role="status">
          {d.kind === "noAccess" ? "Saved views are not available for your organisation or role yet." : "Saved views could not be loaded. Reload the page to try again."}
        </span>
      </div>
    );
  }

  return (
    <div className="fb-sv" role="group" aria-label="Saved views" data-testid="saved-views-bar">
      <span className="fb-sv__label">
        <Bookmark size={14} aria-hidden="true" /> Views
      </span>
      {mine.map((v) => (
        <button key={v.id} type="button" className="fb-sv__pill" onClick={() => onApply(v.state)}>
          {v.name}
          {v.shared ? (
            <span className="fb-sv__shared" title={`Shared by ${v.byName}`}>
              <Users size={12} aria-hidden="true" />
              <span className="fb-sr-only">Shared by {v.byName}</span>
            </span>
          ) : null}
        </button>
      ))}
      {naming === null ? (
        <button type="button" className="fb-sv__add" onClick={() => setNaming("")}>
          Save as view
        </button>
      ) : (
        <form
          className="fb-sv__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input aria-label="Name for this view" placeholder="Name this view" value={naming} autoFocus aria-invalid={Boolean(nameError) || undefined} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} />
          <Button type="submit" size="sm" variant="primary" disabled={!naming.trim() || Boolean(nameError)} disabledReason={nameError ?? (!naming.trim() ? "Give the view a name." : undefined)}>
            Save
          </Button>
          <Button size="sm" onClick={() => setNaming(null)}>
            Cancel
          </Button>
        </form>
      )}
      <button type="button" className="fb-sv__add" onClick={() => setManaging(true)}>
        Manage views
      </button>
      

      <Dialog open={managing} onClose={() => setManaging(false)} title="Manage views" actions={<Button onClick={() => setManaging(false)}>Done</Button>}>
        <ManageList views={views} me={me} actions={actions} toast={(m, tone) => toast.show({ message: m, ...(tone ? { tone } : {}) })} page={page} />
      </Dialog>
    </div>
  );
}

function ManageList({ views, me, actions, toast, page }: { views: SavedView[]; me: { membershipId: string; permissionKeys: readonly string[] }; actions: ReturnType<typeof useViewActions>; toast: (m: string, tone?: "danger") => void; page: ViewPage }) {
  const list = visibleViews(views, me, page);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: () => Promise<unknown>, ok?: string) => {
    try {
      await what();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(why(e), "danger");
      return false;
    }
  };
  // Order applies to the views the person pinned: the server keeps one order per person for their sidebar.
  const pinned = list.filter((v) => v.pinned).sort((a, b) => a.order - b.order);
  const move = (id: string, delta: -1 | 1) => {
    const ids = pinned.map((v) => v.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    void run(() => actions.reorderPinned(ids));
  };
  if (list.length === 0) return <p className="fb-sv__empty">You have no saved views yet. Set up the list how you like it, then choose Save as view.</p>;
  return (
    <ul className="fb-sv__list">
      {list.map((v) => {
        const own = mayEdit(v, me.membershipId);
        const pi = pinned.findIndex((x) => x.id === v.id);
        return (
          <li key={v.id} className="fb-sv__row">
            <div className="fb-sv__rowmain">
              {editing?.id === v.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const problem = nameProblem(editing.name, views.filter((x) => x.by === v.by), v.id);
                    if (problem) return setError(problem);
                    void run(() => actions.rename(v.id, editing.name), "View renamed.").then((ok) => {
                      if (ok) {
                        setEditing(null);
                        setError(null);
                      }
                    });
                  }}
                >
                  <input aria-label={`New name for ${v.name}`} value={editing.name} autoFocus aria-invalid={Boolean(error) || undefined} onChange={(e) => setEditing({ id: v.id, name: e.target.value })} />
                  {error ? <span role="alert" className="fb-sv__err">{error}</span> : null}
                  <Button type="submit" size="sm" variant="primary">Save name</Button>
                </form>
              ) : (
                <>
                  <strong>{v.name}</strong>
                  <span className="fb-sv__meta">{own ? (v.shared ? "Shared with your team" : "Only you") : `Shared by ${v.byName}`}</span>
                </>
              )}
            </div>
            <div className="fb-sv__acts">
              <Button size="sm" disabled={!own} disabledReason={!own ? `Only ${v.byName} can rename this view.` : undefined} onClick={() => setEditing({ id: v.id, name: v.name })}>
                Rename
              </Button>
              <Button size="sm" aria-pressed={v.shared} disabled={!own} disabledReason={!own ? `Only ${v.byName} can change sharing.` : undefined} onClick={() => void run(() => actions.setShared(v.id, !v.shared))}>
                <Share2 size={13} aria-hidden="true" /> {v.shared ? "Stop sharing" : "Share"}
              </Button>
              <Button size="sm" aria-pressed={v.pinned} onClick={() => void run(() => actions.setPinned(v.id, !v.pinned))}>
                {v.pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />} {v.pinned ? "Unpin" : "Pin to sidebar"}
              </Button>
              {v.pinned ? (
                <>
                  <button type="button" className="fb-sv__icon" aria-label={`Move ${v.name} up`} aria-disabled={pi === 0 || undefined} onClick={() => pi > 0 && move(v.id, -1)}>
                    <ChevronUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="fb-sv__icon" aria-label={`Move ${v.name} down`} aria-disabled={pi === pinned.length - 1 || undefined} onClick={() => pi < pinned.length - 1 && move(v.id, 1)}>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              <button type="button" className="fb-sv__icon" aria-label={`Delete ${v.name}`} aria-disabled={!own || undefined} title={!own ? `Only ${v.byName} can delete this view.` : undefined} onClick={() => own && void run(() => actions.remove(v.id), "View deleted.")}>
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
