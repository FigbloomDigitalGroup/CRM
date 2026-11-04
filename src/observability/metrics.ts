/**
 * In-process request metrics in Prometheus text format (P1.02, FIG-1124).
 * Counts are per server process: with several instances, scrape each one and
 * sum in the dashboard (see docs/OBSERVABILITY.md). Labels are kept small on
 * purpose (route group, method, status class) so the series count stays bounded.
 */
export const LATENCY_BUCKETS_SECONDS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const requests = new Map<string, number>();
const durations = new Map<string, { buckets: number[]; sum: number; count: number }>();

/** Replaces ids with placeholders so `/api/orgs/acme/deals/7f3c...` and the next deal share one series. */
export function routeGroup(pathname: string): string {
  const parts = pathname.split("?")[0].split("/").filter(Boolean).slice(0, 6);
  return "/" + parts
    .map((p, i) => {
      if (parts[0] === "api" && parts[1] === "orgs" && i === 2) return ":org";
      return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(p) || /^\d+$/.test(p) || p.length > 24 ? ":id" : p;
    })
    .join("/");
}

export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function recordRequest(input: { method: string; route: string; status: number; durationMs: number }): void {
  const labels = `method="${escapeLabel(input.method.toUpperCase())}",route="${escapeLabel(input.route)}"`;
  const reqKey = `${labels},status="${statusClass(input.status)}"`;
  requests.set(reqKey, (requests.get(reqKey) ?? 0) + 1);

  const seconds = input.durationMs / 1000;
  const h = durations.get(labels) ?? { buckets: LATENCY_BUCKETS_SECONDS.map(() => 0), sum: 0, count: 0 };
  LATENCY_BUCKETS_SECONDS.forEach((le, i) => {
    if (seconds <= le) h.buckets[i] += 1;
  });
  h.sum += seconds;
  h.count += 1;
  durations.set(labels, h);
}

export type JobQueueSample = { type: string; queued: number; running: number; dead: number; oldestDueSeconds: number };

/** The exposition text: request counters, latency histogram, and (when given) the job queue gauges. */
export function renderMetrics(jobs?: JobQueueSample[]): string {
  const out: string[] = [];
  out.push("# HELP figbloom_http_requests_total API requests by route group, method and status class.");
  out.push("# TYPE figbloom_http_requests_total counter");
  for (const [k, v] of requests) out.push(`figbloom_http_requests_total{${k}} ${v}`);

  out.push("# HELP figbloom_http_request_duration_seconds API request latency.");
  out.push("# TYPE figbloom_http_request_duration_seconds histogram");
  for (const [k, h] of durations) {
    LATENCY_BUCKETS_SECONDS.forEach((le, i) => out.push(`figbloom_http_request_duration_seconds_bucket{${k},le="${le}"} ${h.buckets[i]}`));
    out.push(`figbloom_http_request_duration_seconds_bucket{${k},le="+Inf"} ${h.count}`);
    out.push(`figbloom_http_request_duration_seconds_sum{${k}} ${h.sum}`);
    out.push(`figbloom_http_request_duration_seconds_count{${k}} ${h.count}`);
  }

  if (jobs) {
    const gauge = (name: string, help: string, pick: (j: JobQueueSample) => number) => {
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
      for (const j of jobs) out.push(`${name}{type="${escapeLabel(j.type)}"} ${pick(j)}`);
    };
    gauge("figbloom_jobs_queued", "Jobs waiting to run, by type.", (j) => j.queued);
    gauge("figbloom_jobs_running", "Jobs currently running, by type.", (j) => j.running);
    gauge("figbloom_jobs_dead", "Jobs that ran out of attempts (dead-letter list), by type.", (j) => j.dead);
    gauge("figbloom_job_lag_seconds", "Age of the oldest queued job that is already due, by type (0 when none waits).", (j) => j.oldestDueSeconds);
  }
  return out.join("\n") + "\n";
}

export function resetMetrics(): void {
  requests.clear();
  durations.clear();
}
