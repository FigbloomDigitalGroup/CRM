"use client";

import { CalendarClock, CalendarX, Video } from "lucide-react";
import { useState } from "react";
import { Badge, Banner, Button } from "../../components/basics";
import { Checkbox, DateField, Input, Select, TimeField } from "../../components/forms";
import { ConfirmDialog, Dialog, Tabs } from "../../components/overlays";
import { EmptyState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { DEMO_ATTENDEES, MAIL_RECORDS, attendeesWithoutEmail, type DemoMeeting, type MeetingProvider } from "./demo/data";
import { meetingsDemo, useConnection, useMeetings } from "./demo/store";

const PROVIDERS: MeetingProvider[] = ["Google Meet", "Microsoft Teams"];
const attendeeName = (id: string) => DEMO_ATTENDEES.find((a) => a.id === id)?.name ?? "Guest";
const today = () => new Date().toISOString().slice(0, 10);
const dayLabel = (iso: string) => (iso === today() ? "Today" : new Date(`${iso}T00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));

interface Form {
  title: string;
  record: string;
  attendees: string[];
  date: string;
  time: string;
  minutes: string;
  provider: MeetingProvider;
  followUp: boolean;
}

const blank = (): Form => ({ title: "", record: "", attendees: [], date: today(), time: "10:00", minutes: "30", provider: "Google Meet", followUp: true });

/**
 * Video Conference (F6.23, FIG-1381): start or schedule a meeting from a record through the connected calendar provider (Google Meet or
 * Microsoft Teams). This is a meeting link, not a video engine of our own. A meeting is logged on the record's timeline and in Conversations
 * (Meetings tab), with an optional follow-up task. On demo data (`demo/`) until FIG-808 and FIG-1153 land in M13.
 */
export function VideoConference() {
  const { canAny, orgSlug, roleName } = useMember();
  const toast = useToast();
  const meetings = useMeetings();
  const { connected, ready, connect } = useConnection("calendar", orgSlug);
  const [tab, setTab] = useState("upcoming");
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Partial<Record<"title" | "attendees" | "date", string>>>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [move, setMove] = useState({ date: today(), time: "10:00" });
  const [defaultProvider, setDefaultProvider] = useState<MeetingProvider>("Google Meet");

  if (!canAny("tasks.view.own", "tasks.view.all")) {
    return (
      <div className="fb-comm">
        <h1 className="fb-comm__title">Video Conference</h1>
        <NoAccess area="Video Conference" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales", "Delivery", "Customer Support"], whoToAsk: ["Management"] }} />
      </div>
    );
  }

  const reason = !ready ? undefined : connected ? undefined : "Connect your calendar first, in Settings > Email and calendar or with the Connect button above.";
  const upcoming = meetings.filter((m) => m.status === "upcoming");
  const past = meetings.filter((m) => m.status !== "upcoming");
  const missing = form ? attendeesWithoutEmail(form.attendees) : [];

  function create() {
    if (!form) return;
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = "Give the meeting a title.";
    if (form.attendees.length === 0) e.attendees = "Choose at least one attendee.";
    if (!form.date || form.date < today()) e.date = "Choose today or a later date.";
    setErrors(e);
    if (Object.keys(e).length) return;
    const record = MAIL_RECORDS.find((r) => r.value === form.record)?.label ?? "No record";
    const invited = form.attendees.filter((id) => !attendeesWithoutEmail([id]).length);
    meetingsDemo.create({ title: form.title.trim(), record, provider: form.provider, day: dayLabel(form.date), time: form.time, minutes: Number(form.minutes), attendees: form.attendees });
    toast.show({
      message: `Scheduled with ${form.provider}. ${invited.length} invite${invited.length === 1 ? "" : "s"} sent${missing.length ? `, ${missing.length} not sent (no email)` : ""}. Logged on ${record === "No record" ? "your calendar" : record.replace(/^\w+: /, "")} and in Conversations.${form.followUp ? " Follow-up task added." : ""}`,
      tone: "success",
    });
    setForm(null);
    setTab("upcoming");
  }

  function startNow() {
    meetingsDemo.create({ title: "Quick meeting", record: "No record", provider: defaultProvider, day: "Today", time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), minutes: 30, attendees: [] });
    toast.show({ message: `Meeting started with ${defaultProvider}. Share the link from the list.`, tone: "success" });
    setTab("upcoming");
  }

  const row = (m: DemoMeeting) => (
    <li key={m.id} className="fb-vid__row">
      <span className="fb-vid__icon" aria-hidden="true"><Video size={18} /></span>
      <div className="fb-vid__main">
        <strong>{m.title}</strong>
        <span>{m.day} at {m.time} · {m.minutes} min · {m.provider}</span>
        <span>{m.record} · {m.attendees.map(attendeeName).join(", ") || "No attendees yet"}</span>
      </div>
      <div className="fb-vid__actions">
        {m.status === "cancelled" ? <Badge tone="danger">Cancelled</Badge> : m.status === "past" ? <Badge tone="neutral">Done · on the timeline</Badge> : (
          <>
            <Button variant="primary" onClick={() => toast.show({ message: `Opening ${m.provider} (${m.joinCode})`, tone: "info" })}>Join</Button>
            <Button onClick={() => { setMoveId(m.id); setMove({ date: today(), time: m.time }); }}>Reschedule</Button>
            <Button variant="ghost" onClick={() => setCancelId(m.id)}>Cancel</Button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className="fb-comm">
      <div className="fb-comm__head">
        <div>
          <h1 className="fb-comm__title">Video Conference</h1>
          <p className="fb-comm__sub">Meet customers and colleagues with a Google Meet or Teams link. Every meeting is logged on the record.</p>
        </div>
        <div className="fb-vid__start">
          <Select label="Provider" value={defaultProvider} onChange={(e) => setDefaultProvider(e.target.value as MeetingProvider)} options={PROVIDERS.map((p) => ({ value: p, label: p }))} />
          <Button onClick={startNow} disabledReason={reason}><Video size={16} aria-hidden="true" /> Start now</Button>
          <Button variant="primary" onClick={() => { setForm({ ...blank(), provider: defaultProvider }); setErrors({}); }} disabledReason={reason}><CalendarClock size={16} aria-hidden="true" /> Schedule</Button>
        </div>
      </div>

      {ready && !connected ? (
        <Banner tone="warning" icon={<CalendarX size={16} />} title="Your calendar is not connected." action={<Button size="sm" onClick={() => setConnectOpen(true)}>Connect calendar</Button>}>
          Meeting links are created through your calendar. Connect Google or Microsoft (Settings &gt; Email and calendar) to start or schedule a meeting.
        </Banner>
      ) : null}

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

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title="Schedule a meeting"
        actions={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={create}>Schedule and send invites</Button>
          </>
        }
      >
        {form ? (
          <div className="fb-mail__compose">
            <Input label="Title" required value={form.title} error={errors.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Select label="Record" value={form.record} onChange={(e) => setForm({ ...form, record: e.target.value })} placeholder="No record" options={MAIL_RECORDS.map((r) => ({ value: r.value, label: r.label }))} help="The meeting is logged on this record's timeline and in Conversations." />
            <fieldset className="fb-vid__attendees">
              <legend>Attendees <span className="fb-req" aria-hidden="true">*</span></legend>
              {DEMO_ATTENDEES.map((a) => (
                <Checkbox
                  key={a.id}
                  label={<>{a.name} {a.email ? null : <Badge tone="warning">No email</Badge>}</>}
                  checked={form.attendees.includes(a.id)}
                  onChange={(e) => setForm({ ...form, attendees: e.target.checked ? [...form.attendees, a.id] : form.attendees.filter((x) => x !== a.id) })}
                />
              ))}
              {errors.attendees ? <span className="fb-error" role="alert">{errors.attendees}</span> : null}
            </fieldset>
            {missing.length ? (
              <Banner tone="warning" title="No email on file.">{missing.map((a) => a.name).join(", ")} will not get an invite. Add an email to the contact, or share the link yourself.</Banner>
            ) : null}
            <div className="fb-vid__when">
              <DateField label="Date" required value={form.date} min={today()} error={errors.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <TimeField label="Time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              <Select label="Length" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} options={["15", "30", "45", "60"].map((m) => ({ value: m, label: `${m} minutes` }))} />
            </div>
            <Select label="Provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as MeetingProvider })} options={PROVIDERS.map((p) => ({ value: p, label: p }))} />
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
            <Button variant="primary" onClick={() => { if (moveId) meetingsDemo.reschedule(moveId, dayLabel(move.date), move.time); setMoveId(null); toast.show({ message: "Rescheduled. Attendees were sent the new time.", tone: "success" }); }}>Save</Button>
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
        onConfirm={() => { if (cancelId) meetingsDemo.cancel(cancelId); setCancelId(null); toast.show({ message: "Meeting cancelled", tone: "info" }); }}
      />
      <ConfirmDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect your calendar"
        body="You will sign in with your provider. Figbloom creates meeting links and adds the events you schedule here. You can disconnect at any time. (Demo: nothing leaves this device.)"
        confirmLabel="Connect"
        onConfirm={() => { connect(); setConnectOpen(false); toast.show({ message: "Calendar connected", tone: "success" }); }}
      />
    </div>
  );
}
