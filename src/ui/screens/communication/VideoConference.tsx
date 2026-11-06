"use client";

import { CalendarClock, CalendarX, Video } from "lucide-react";
import { useState } from "react";
import { Badge, Banner, Button } from "../../components/basics";
import { Checkbox, DateField, Input, Select, Textarea, TimeField } from "../../components/forms";
import { ConfirmDialog, Dialog, Tabs } from "../../components/overlays";
import { EmptyState, LoadingState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { meetingLink, useConnection, useMeetingActions, useMeetings, type MeetingItem, type RecordRef, type ScheduledMeeting } from "./api";
import { RecordPicker } from "./RecordPicker";

const PROVIDER_NAME = { GOOGLE: "Google Meet", MICROSOFT: "Microsoft Teams" } as const;
const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const nowTime = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** The time a new meeting starts at: 10:00 while that is still ahead, otherwise the next half hour (never a time the form itself would refuse as already past). */
const defaultTime = () => {
  const d = new Date();
  if (d.getHours() < 9 || (d.getHours() === 9 && d.getMinutes() < 30)) return "10:00";
  const next = new Date(d.getTime() + 30 * 60_000 - (d.getTime() % (30 * 60_000)));
  return next.getDate() === d.getDate() ? `${pad(next.getHours())}:${pad(next.getMinutes())}` : nowTime();
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const KIND_LABEL: Record<string, string> = { Lead: "Lead", Deal: "Deal", Company: "Company", Contact: "Contact" };

interface Form {
  title: string;
  record: RecordRef | null;
  attendees: string;
  description: string;
  date: string;
  time: string;
  minutes: string;
  withVideo: boolean;
  followUp: boolean;
}
const blank = (): Form => ({ title: "", record: null, attendees: "", description: "", date: today(), time: defaultTime(), minutes: "30", withVideo: true, followUp: true });
const emails = (s: string) => s.split(/[,;\s]+/).map((a) => a.trim()).filter(Boolean);

/**
 * Video Conference (F6.23, FIG-1381) on the real API (docs/MAIL_AND_CALENDAR_SYNC.md): schedule a meeting from a record through the connected
 * calendar (Google Meet or Teams link), reschedule and cancel it. The calendar feed is the only list of meetings the API offers, so the join
 * link and the attendees are shown for meetings scheduled in this session; the cancelled state likewise.
 */
export function VideoConference() {
  const { can, roleName } = useMember();
  const toast = useToast();
  const conn = useConnection("CALENDAR", can("meetings.schedule"));
  const allowed = can("meetings.schedule");
  const { meetings, isLoading, error, refetch } = useMeetings(allowed);
  const actions = useMeetingActions();
  const [tab, setTab] = useState("upcoming");
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Partial<Record<"title" | "record" | "attendees" | "date", string>>>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [provider, setProvider] = useState<"GOOGLE" | "MICROSOFT">("GOOGLE");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [move, setMove] = useState({ date: today(), time: defaultTime() });
  const [session, setSession] = useState<Record<string, ScheduledMeeting>>({});
  const [cancelled, setCancelled] = useState<string[]>([]);

  if (!allowed) {
    return (
      <div className="fb-comm">
        <h1 className="fb-comm__title">Video Conference</h1>
        <NoAccess area="Video Conference" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales", "Delivery"], whoToAsk: ["Management"] }} />
      </div>
    );
  }
  if (error) return <div className="fb-comm"><h1 className="fb-comm__title">Video Conference</h1><QueryFailure error={error} area="Video Conference" onRetry={() => void refetch()} /></div>;

  const providerName = conn.item?.provider ? PROVIDER_NAME[conn.item.provider] : "your calendar";
  const reason = !conn.ready ? "Checking your calendar." : conn.connected ? undefined : "Connect your calendar first, in Settings > Email and calendar or with the Connect button above.";
  const fail = (e: unknown) => toast.show({ message: describeError(e).body, tone: "danger" });
  const now = Date.now();
  const isCancelled = (m: MeetingItem) => cancelled.includes(m.id) || session[m.id]?.status === "CANCELLED";
  const upcoming = meetings.filter((m) => new Date(m.start).getTime() >= now - 30 * 60_000 && !isCancelled(m));
  const past = meetings.filter((m) => !upcoming.includes(m)).reverse();

  function create() {
    if (!form) return;
    const e: typeof errors = {};
    const list = emails(form.attendees);
    if (!form.title.trim()) e.title = "Give the meeting a title.";
    if (!form.record) e.record = "Choose the record the meeting is about.";
    if (list.some((a) => !/^\S+@\S+\.\S+$/.test(a))) e.attendees = "Use full email addresses, separated by commas.";
    const start = new Date(`${form.date}T${form.time}`);
    if (!form.date || Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 5 * 60_000) e.date = "Choose today or a later date and time.";
    setErrors(e);
    if (Object.keys(e).length) return;
    const end = new Date(start.getTime() + Number(form.minutes) * 60_000);
    actions.schedule(
      {
        title: form.title.trim(),
        start: start.toISOString(),
        end: end.toISOString(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(list.length ? { attendees: list } : {}),
        withVideo: form.withVideo,
        link: meetingLink(form.record!),
        ...(form.followUp ? { followUp: { title: `Follow up: ${form.title.trim()}`, dueAt: end.toISOString() } } : {}),
      },
      {
        onSuccess: (m) => {
          setSession((s) => ({ ...s, [m.activityId]: m }));
          toast.show({ message: `Scheduled. Invites were sent to ${m.attendees.length} ${m.attendees.length === 1 ? "person" : "people"}. Logged on ${form.record!.label} and in Conversations.${form.followUp ? " Follow-up task added." : ""}`, tone: "success" });
          setForm(null);
          setTab("upcoming");
        },
        onError: fail,
      },
    );
  }

  const row = (m: MeetingItem) => {
    const s = session[m.id];
    const done = isCancelled(m);
    const isPast = !done && !upcoming.includes(m);
    return (
      <li key={m.id} className="fb-vid__row">
        <span className="fb-vid__icon" aria-hidden="true"><Video size={18} /></span>
        <div className="fb-vid__main">
          <strong>{m.title}</strong>
          <span>{when(m.start)} · {providerName}</span>
          <span>{m.link ? KIND_LABEL[m.link.type] : "No record"}{s ? ` · ${s.attendees.join(", ") || "No attendees yet"}` : m.assigneeName ? ` · ${m.assigneeName}` : ""}</span>
        </div>
        <div className="fb-vid__actions">
          {done ? <Badge tone="danger">Cancelled</Badge> : isPast ? <Badge tone="neutral">Done · on the timeline</Badge> : (
            <>
              {s?.joinUrl ? <a className="fb-btn fb-btn--primary" href={s.joinUrl} target="_blank" rel="noopener noreferrer">Join</a> : null}
              <Button onClick={() => { setMoveId(m.id); setMove({ date: m.start.slice(0, 10), time: new Date(m.start).toTimeString().slice(0, 5) }); }}>Reschedule</Button>
              <Button variant="ghost" onClick={() => setCancelId(m.id)}>Cancel</Button>
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="fb-comm">
      <div className="fb-comm__head">
        <div>
          <h1 className="fb-comm__title">Video Conference</h1>
          <p className="fb-comm__sub">Meet customers and colleagues with a Google Meet or Teams link. Every meeting is logged on the record.</p>
        </div>
        <div className="fb-vid__start">
          <Button onClick={() => { setForm({ ...blank(), title: "Quick meeting", time: nowTime() }); setErrors({}); }} disabledReason={reason}><Video size={16} aria-hidden="true" /> Start now</Button>
          <Button variant="primary" onClick={() => { setForm(blank()); setErrors({}); }} disabledReason={reason}><CalendarClock size={16} aria-hidden="true" /> Schedule</Button>
        </div>
      </div>

      {conn.ready && !conn.connected ? (
        <Banner tone="warning" icon={<CalendarX size={16} />} title={conn.item?.state === "NEEDS_RECONNECT" ? "Your calendar needs to be reconnected." : "Your calendar is not connected."} action={<Button size="sm" onClick={() => setConnectOpen(true)}>Connect calendar</Button>}>
          {conn.item?.stateReason || "Meeting links are created through your calendar."} Connect Google or Microsoft to start or schedule a meeting.
        </Banner>
      ) : null}

      {isLoading ? (
        <LoadingState label="Loading meetings" lines={3} />
      ) : (
        <Tabs
          label="Meetings"
          value={tab}
          onChange={setTab}
          tabs={[
            {
              id: "upcoming",
              label: `Upcoming (${upcoming.length})`,
              panel: upcoming.length ? <ul className="fb-vid__list">{upcoming.map(row)}</ul> : <EmptyState icon={<Video size={22} />} title="No upcoming meetings" body="Schedule one from here, or from a lead, deal, company or contact." />,
            },
            {
              id: "past",
              label: `Past and cancelled (${past.length})`,
              panel: past.length ? <ul className="fb-vid__list">{past.map(row)}</ul> : <EmptyState title="Nothing yet" body="Finished and cancelled meetings are listed here." />,
            },
          ]}
        />
      )}

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title="Schedule a meeting"
        actions={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabledReason={actions.busy ? "Scheduling." : undefined}>Schedule and send invites</Button>
          </>
        }
      >
        {form ? (
          <div className="fb-mail__compose">
            <Input label="Title" required value={form.title} error={errors.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <RecordPicker label="Record" value={form.record} onChange={(record) => setForm({ ...form, record })} kinds={["deal", "company", "lead", "contact"]} error={errors.record} help="The meeting is logged on this record's timeline and in Conversations. Its contact is invited without typing." />
            <Input label="Other attendees (emails)" value={form.attendees} error={errors.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} help="Separate several addresses with commas." />
            <div className="fb-vid__when">
              <DateField label="Date" required value={form.date} min={today()} error={errors.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <TimeField label="Time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              <Select label="Length" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} options={["15", "30", "45", "60"].map((m) => ({ value: m, label: `${m} minutes` }))} />
            </div>
            <Textarea label="Notes" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Checkbox label={`Add a ${providerName === "your calendar" ? "video" : providerName} link`} checked={form.withVideo} onChange={(e) => setForm({ ...form, withVideo: e.target.checked })} />
            <Checkbox label="Add a follow-up task for me after the meeting" checked={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.checked })} />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={moveId !== null}
        onClose={() => setMoveId(null)}
        title="Reschedule meeting"
        actions={
          <>
            <Button onClick={() => setMoveId(null)}>Cancel</Button>
            <Button variant="primary" disabledReason={actions.busy ? "Saving." : undefined} onClick={() => { if (moveId) actions.reschedule(moveId, new Date(`${move.date}T${move.time}`).toISOString(), { onSuccess: () => { setMoveId(null); toast.show({ message: "Rescheduled. Attendees were sent the new time.", tone: "success" }); }, onError: fail }); }}>Save</Button>
          </>
        }
      >
        <div className="fb-vid__when">
          <DateField label="Date" value={move.date} min={today()} onChange={(e) => setMove({ ...move, date: e.target.value })} />
          <TimeField label="Time" value={move.time} onChange={(e) => setMove({ ...move, time: e.target.value })} />
        </div>
      </Dialog>

      <ConfirmDialog
        open={cancelId !== null}
        onClose={() => setCancelId(null)}
        title="Cancel this meeting?"
        body="Attendees are told it is cancelled and the calendar event is removed. The record keeps a note that it was cancelled."
        confirmLabel="Cancel meeting"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={() => {
          const id = cancelId;
          setCancelId(null);
          if (id) actions.cancel(id, { onSuccess: () => { setCancelled((c) => [...c, id]); toast.show({ message: "Meeting cancelled", tone: "info" }); }, onError: fail });
        }}
      />
      <Dialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect your calendar"
        actions={
          <>
            <Button onClick={() => setConnectOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => conn.connect(provider, fail)} disabledReason={conn.starting ? "Opening your provider." : undefined}>Connect</Button>
          </>
        }
      >
        <p>You will sign in with your provider. Figbloom creates meeting links and adds the events you schedule here. You can disconnect at any time.</p>
        <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value as "GOOGLE" | "MICROSOFT")} options={[{ value: "GOOGLE", label: "Google Calendar" }, { value: "MICROSOFT", label: "Microsoft 365 calendar" }]} />
      </Dialog>
    </div>
  );
}
