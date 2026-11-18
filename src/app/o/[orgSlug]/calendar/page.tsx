import { Suspense } from "react";
import { resolveRequestContext } from "@/auth/requestContext";
import { CalendarScreen } from "@/ui/screens/tasks";

/** The calendar (F2.08, T2): month, week, day and list of tasks, calls and meetings. Data comes from `GET /calendar`. */
export default async function CalendarPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug); // a person outside the organisation is turned away here
  return (
    <Suspense>
      <CalendarScreen />
    </Suspense>
  );
}
