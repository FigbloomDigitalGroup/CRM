/**
 * Demo data for the Social workspace (UC-S4 to UC-S6, design file CrmSocial). Nothing here is real: no network is called and nobody is scraped.
 * Wiring to the connector foundation (S2) and the pilot connector (S3) replaces this module; search for `demo/` to find what is left.
 */

export type ChannelKey = "ig" | "fb" | "li" | "tt" | "x";
export const CHANNELS: Record<ChannelKey, { name: string; ab: string }> = {
  ig: { name: "Instagram", ab: "IG" },
  fb: { name: "Facebook", ab: "FB" },
  li: { name: "LinkedIn", ab: "in" },
  tt: { name: "TikTok", ab: "TT" },
  x: { name: "X", ab: "X" },
};

export interface SocialAccount { key: ChannelKey; handle: string; followers: number; delta: number; connected: boolean; syncedAt: string; reach30: number; engagement: number }
export interface Mention { id: string; ch: ChannelKey; who: string; handle: string; text: string; when: string; sentiment: "Positive" | "Neutral" | "Negative"; reach: string; leadable: boolean }
export interface ThreadMessage { dir: "in" | "out"; text: string; time: string }
export interface Thread { id: string; ch: ChannelKey; who: string; handle: string; unread: boolean; status: "open" | "done"; assignedTo: string; messages: ThreadMessage[] }
export type PostStatus = "Scheduled" | "Needs approval" | "Draft" | "Published";
export interface Post { id: string; channels: ChannelKey[]; text: string; day: number; time: string; status: PostStatus; campaignId: string; boost: boolean; reach?: number; engaged?: number }
export interface Campaign { id: string; name: string; goal: string; status: "Active" | "Scheduled" | "Ended" | "Draft" | "Paused"; channels: ChannelKey[]; startDay: number; endDay: number; budget: number; spent: number; reach: number; clicks: number; leads: number; deals: number; pipelineValue: number }
export interface SocialLead { id: string; name: string; source: string; owner: string | null; status: string }

export const ACCOUNTS: SocialAccount[] = [
  { key: "ig", handle: "@figbloomdigital", followers: 12480, delta: 312, connected: true, syncedAt: "4 min ago", reach30: 21400, engagement: 4.6 },
  { key: "fb", handle: "Figbloom Digital Group", followers: 8920, delta: 96, connected: true, syncedAt: "4 min ago", reach30: 12900, engagement: 3.2 },
  { key: "li", handle: "Figbloom Digital Group", followers: 5210, delta: 141, connected: true, syncedAt: "9 min ago", reach30: 8300, engagement: 5.1 },
  { key: "tt", handle: "@figbloom.ke", followers: 3140, delta: 420, connected: true, syncedAt: "12 min ago", reach30: 4900, engagement: 6.8 },
  { key: "x", handle: "@figbloomke", followers: 2390, delta: 18, connected: false, syncedAt: "2 days ago", reach30: 700, engagement: 1.9 },
];

export const MENTIONS: Mention[] = [
  { id: "m1", ch: "ig", who: "Tausi Beauty Lounge", handle: "@tausibeauty", text: "Our new site from @figbloomdigital is live and bookings are already up. Thank you, team!", when: "Today 09:12", sentiment: "Positive", reach: "4.2k", leadable: false },
  { id: "m2", ch: "li", who: "Kevin Ochieng", handle: "Head of IT, Twiga Foods", text: "Looking for a partner for fleet GPS and a driver app. Has anyone here worked with Figbloom Digital?", when: "Today 08:40", sentiment: "Neutral", reach: "1.1k", leadable: true },
  { id: "m3", ch: "x", who: "Nairobi Dev", handle: "@nairobi_dev", text: "Second time this month the parent portal was slow before 8 am. Any update, @figbloomke?", when: "Yesterday 18:05", sentiment: "Negative", reach: "640", leadable: false },
  { id: "m4", ch: "fb", who: "Sarova Hotels", handle: "Sarova Hotels", text: "Shared your post on CCTV for hospitality. A useful case study for hotel managers.", when: "Yesterday 14:20", sentiment: "Positive", reach: "2.3k", leadable: false },
  { id: "m5", ch: "tt", who: "Mama Mboga Tech", handle: "@mama_mboga_tech", text: "Stitched your \"5 signs your website loses leads\" video. Number 3 is so true.", when: "2 days ago", sentiment: "Positive", reach: "9.8k", leadable: false },
  { id: "m6", ch: "ig", who: "Wanjiru M.", handle: "@wanjiru.designs", text: "How much is a logo and brand kit for a small bakery? Sent you a DM.", when: "2 days ago", sentiment: "Neutral", reach: "310", leadable: true },
];

export const THREADS: Thread[] = [
  { id: "t1", ch: "ig", who: "Wanjiru M.", handle: "@wanjiru.designs", unread: true, status: "open", assignedTo: "", messages: [{ dir: "in", text: "Hi! How much is a logo and brand kit for a small bakery in Kilimani?", time: "09:41" }] },
  { id: "t2", ch: "fb", who: "Brian Otieno", handle: "Brian Otieno", unread: true, status: "open", assignedTo: "", messages: [{ dir: "in", text: "Do you install CCTV in Kisumu? We need about 12 cameras for a warehouse.", time: "08:55" }] },
  { id: "t3", ch: "li", who: "Kevin Ochieng", handle: "Head of IT, Twiga Foods", unread: true, status: "open", assignedTo: "Marketing", messages: [{ dir: "out", text: "Hi Kevin, saw your post about fleet GPS. Happy to share how we set it up for other logistics teams.", time: "08:45" }, { dir: "in", text: "Thanks. Can we talk next week? Tuesday works.", time: "09:02" }] },
  { id: "t4", ch: "x", who: "Nairobi Dev", handle: "@nairobi_dev", unread: false, status: "open", assignedTo: "Marketing", messages: [{ dir: "in", text: "Portal was slow again this morning.", time: "Yesterday 18:05" }, { dir: "out", text: "Sorry about that. We have passed it to our technical team and will update you today.", time: "Yesterday 18:20" }] },
  { id: "t5", ch: "ig", who: "Tausi Beauty Lounge", handle: "@tausibeauty", unread: false, status: "open", assignedTo: "Marketing", messages: [{ dir: "in", text: "Can you boost our launch post as well?", time: "Yesterday 12:10" }, { dir: "out", text: "Yes! We will send a small boost plan by Wednesday.", time: "Yesterday 12:40" }] },
  { id: "t6", ch: "tt", who: "Kicks KE", handle: "@kicks_ke", unread: false, status: "done", assignedTo: "Marketing", messages: [{ dir: "in", text: "Love the video! Do you manage TikTok for small shops?", time: "3 days ago" }, { dir: "out", text: "We do. Sent you our small-business package by DM.", time: "3 days ago" }] },
];

export const POSTS: Post[] = [
  { id: "p1", channels: ["ig", "fb"], text: "Behind the build: how we took Tausi Beauty Lounge from DMs to online bookings in three weeks.", day: 0, time: "11:00", status: "Scheduled", campaignId: "c1", boost: false },
  { id: "p2", channels: ["li"], text: "Fleet managers: three numbers your GPS dashboard should show you every morning.", day: 0, time: "15:30", status: "Scheduled", campaignId: "c2", boost: false },
  { id: "p3", channels: ["tt", "ig"], text: "5 signs your website is losing leads (part 2).", day: 1, time: "18:00", status: "Scheduled", campaignId: "c1", boost: false },
  { id: "p4", channels: ["fb", "ig"], text: "Hotels in Nairobi: book a free CCTV site survey before 30 November.", day: 2, time: "10:00", status: "Needs approval", campaignId: "c3", boost: true },
  { id: "p5", channels: ["li", "x"], text: "We are hiring a junior React developer in Nairobi. Hybrid, three days in the office.", day: 3, time: "09:00", status: "Scheduled", campaignId: "", boost: false },
  { id: "p6", channels: ["ig"], text: "Client spotlight: the Hillcrest Prep parent portal, one term in.", day: 4, time: "12:00", status: "Draft", campaignId: "", boost: false },
  { id: "p7", channels: ["ig", "fb"], text: "Weekend tip: reply to every DM within the hour. Here is how small teams manage it.", day: 5, time: "10:00", status: "Scheduled", campaignId: "c1", boost: false },
  { id: "p8", channels: ["ig", "fb"], text: "Tausi Beauty Lounge's new website is live. Book a treatment in two taps.", day: -1, time: "10:00", status: "Published", campaignId: "c1", boost: false, reach: 6400, engaged: 461 },
  { id: "p9", channels: ["li"], text: "Case study: rolling out 40 CCTV cameras across Sarova Hotels.", day: -2, time: "09:30", status: "Published", campaignId: "", boost: false, reach: 3900, engaged: 288 },
  { id: "p10", channels: ["tt"], text: "5 signs your website is losing leads (part 1).", day: -4, time: "18:00", status: "Published", campaignId: "c1", boost: false, reach: 9800, engaged: 902 },
];

export const CAMPAIGNS: Campaign[] = [
  { id: "c1", name: "Websites that book", goal: "Leads", status: "Active", channels: ["ig", "tt", "fb"], startDay: -14, endDay: 16, budget: 60000, spent: 31200, reach: 48200, clicks: 1840, leads: 23, deals: 3, pipelineValue: 1450000 },
  { id: "c2", name: "Fleet GPS for logistics", goal: "Leads", status: "Active", channels: ["li"], startDay: -7, endDay: 21, budget: 40000, spent: 9800, reach: 12400, clicks: 410, leads: 6, deals: 0, pipelineValue: 0 },
  { id: "c3", name: "Hospitality CCTV", goal: "Leads", status: "Scheduled", channels: ["fb", "ig"], startDay: 2, endDay: 32, budget: 80000, spent: 0, reach: 0, clicks: 0, leads: 0, deals: 0, pipelineValue: 0 },
  { id: "c4", name: "Back-to-school portals", goal: "Leads", status: "Ended", channels: ["fb", "ig"], startDay: -75, endDay: -30, budget: 50000, spent: 49100, reach: 61000, clicks: 2210, leads: 31, deals: 7, pipelineValue: 3100000 },
  { id: "c5", name: "December retainers", goal: "Awareness", status: "Draft", channels: ["li", "ig"], startDay: 30, endDay: 60, budget: 30000, spent: 0, reach: 0, clicks: 0, leads: 0, deals: 0, pipelineValue: 0 },
];

export const SOCIAL_LEADS: { id: string; name: string; source: string; owner: string | null; status: string }[] = [
  { id: "l1", name: "Tausi Beauty Lounge", source: "Instagram", owner: "Sales", status: "Qualified" },
  { id: "l2", name: "Hillcrest Prep", source: "Facebook", owner: null, status: "New" },
  { id: "l3", name: "Savannah Logistics", source: "LinkedIn", owner: "Sales", status: "Contacted" },
];

export const DAILY_ENGAGEMENT = [310, 280, 340, 420, 390, 260, 240, 360, 410, 520, 480, 450, 300, 280, 350, 430, 470, 610, 560, 420, 330, 310, 390, 450, 500, 540, 480, 360, 340, 410];

/** KES, whole shillings. */
export const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
export const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(v >= 1e4 ? 0 : 1)}k` : String(v));
export const dayLabel = (d: number) => (d === 0 ? "Today" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : d > 0 ? `In ${d} days` : `${-d} days ago`);
