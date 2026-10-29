import type { AskContext, AssistantItem, AssistantMessage, Respond } from "../types";
import { DEMO_DEALS, DEMO_LEADS, DEMO_TASKS } from "./data";

/**
 * The demo assistant: canned answers over the sample records, with the same rules the real one must keep (B6.20, hard rule 7):
 * it reads only what the role may open, never says a deal value to a role without `deals.view.value`, and never acts: a suggestion comes
 * back as a card to confirm. Swapped for the API in M13.
 */

let counter = 0;
const id = () => `m${++counter}`;
const has = (ctx: AskContext, key: string) => ctx.permissionKeys.includes(key);
const sees = (ctx: AskContext, ...keys: string[]) => keys.some((k) => has(ctx, k));

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

function basisFor(ctx: AskContext, leads: number, deals: number): string {
  return `Based on ${ctx.roleName} access · ${leads} lead${leads === 1 ? "" : "s"}, ${deals} deal${deals === 1 ? "" : "s"}`;
}

export const demoRespond: Respond = async (question, ctx) => {
  const q = question.toLowerCase();
  const me: AssistantMessage = { id: id(), who: "me", text: question };
  const canLeads = sees(ctx, "leads.view.own", "leads.view.all", "leads.view.shared");
  const canDeals = sees(ctx, "deals.view.own", "deals.view.all", "deals.view.won");
  const canTasks = sees(ctx, "tasks.view.own", "tasks.view.all");
  const canValue = has(ctx, "deals.view.value");
  const leads = canLeads ? DEMO_LEADS : [];
  const deals = canDeals ? (has(ctx, "deals.view.won") && !has(ctx, "deals.view.all") && !has(ctx, "deals.view.own") ? DEMO_DEALS.filter((d) => d.stage === "Closed Won") : DEMO_DEALS) : [];
  const basis = basisFor(ctx, leads.length, deals.length);
  const ai = (o: Partial<AssistantMessage> & { text: string }): AssistantMessage => ({ id: id(), who: "ai", basis, actionState: o.action ? "pending" : undefined, ...o });
  const noAccess = (what: string) => [me, ai({ text: `Your role can’t open ${what}, so I can’t answer questions about them. Ask a Management member if you need access.` })];

  if (/draft|follow.?up|write/.test(q) && ctx.record) {
    return [me, ai({ text: "Here’s a draft. Edit it, then send it yourself. I never send anything.", draft: `Hi, thanks for your time on our last call about ${ctx.record.name}. I’ve attached the details we discussed. Could we confirm next steps by Friday?`, basis: "From the last 3 timeline items" })];
  }
  if (/proposal|reply|quote/.test(q)) {
    if (!canDeals) return noAccess("deals");
    const ds = deals.filter((d) => d.stage === "Proposal Sent" && d.silentDays >= 7);
    const items: AssistantItem[] = ds.map((d) => ({ title: `${d.company} · ${d.title}`, sub: `${d.stage} · no reply for ${d.silentDays} days${canValue ? ` · ${kes(d.value)}` : ""}`, href: `/o/${ctx.orgSlug}/deals` }));
    const first = ds[0];
    return [
      me,
      ai({
        text: ds.length ? `${ds.length} proposal${ds.length > 1 ? "s are" : " is"} waiting with no reply logged:` : "No proposals are waiting for a reply.",
        items,
        ...(first
          ? { action: { kind: "task" as const, title: `Follow up on the proposal to ${first.company}`, forWhom: first.owner, due: "Tomorrow", about: `${first.company} · deal` } }
          : {}),
      }),
    ];
  }
  if (/hot|no task|without/.test(q)) {
    if (!canLeads) return noAccess("leads");
    const ls = leads.filter((l) => l.temp === "Hot" && !l.hasOpenTask);
    return [me, ai({ text: ls.length ? `${ls.length} Hot lead${ls.length > 1 ? "s have" : " has"} no open task:` : "Every Hot lead has an open task.", items: ls.map((l) => ({ title: l.name, sub: `${l.status} · ${l.service}`, href: `/o/${ctx.orgSlug}/leads` })) })];
  }
  if (/overdue|late/.test(q)) {
    if (!canTasks) return noAccess("tasks");
    return [me, ai({ text: `${DEMO_TASKS.length} overdue tasks:`, items: DEMO_TASKS.map((t) => ({ title: t.title, sub: `${t.about} · ${t.overdueDays} day${t.overdueDays === 1 ? "" : "s"} late`, href: `/o/${ctx.orgSlug}/tasks` })) })];
  }
  if (/pipeline|value|worth|revenue/.test(q)) {
    if (!canDeals) return noAccess("deals");
    const open = deals.filter((d) => !d.stage.startsWith("Closed"));
    if (!canValue) {
      return [me, ai({ text: `You have ${open.length} open deal${open.length === 1 ? "" : "s"}. Deal values are hidden for your role, so I can’t add them up. I can still list them by stage.`, items: open.map((d) => ({ title: `${d.company} · ${d.title}`, sub: d.stage, href: `/o/${ctx.orgSlug}/deals` })) })];
    }
    return [me, ai({ text: `Your open pipeline is worth ${kes(open.reduce((s, d) => s + d.value, 0))} across ${open.length} deals.` })];
  }
  return [me, ai({ text: "I can answer questions about records you can see: proposals with no reply, Hot leads with no task, overdue follow-ups, pipeline value. I can also draft messages and suggest next actions for you to confirm." })];
};
