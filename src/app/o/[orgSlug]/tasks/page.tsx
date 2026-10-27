import { Suspense } from "react";
import { resolveRequestContext } from "@/auth/requestContext";
import { recordPageView } from "@/services/pageViewService";
import { TasksScreen } from "@/ui/screens/tasks";

/**
 * Tasks grouped by due state (F2.07, T1). The screen itself is a client component that reads `GET /tasks/groups`; this stays on the server only
 * to resolve the organisation (a person outside it is turned away here) and to record the page view the activity statistics use.
 */
export default async function TasksPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "tasks");
  return (
    <Suspense>
      <TasksScreen />
    </Suspense>
  );
}
