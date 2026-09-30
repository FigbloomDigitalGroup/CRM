import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/auth/requestContext";

// V1 has exactly one organization (FigBloom itself), so this skips
// straight to it rather than building an organization picker nothing needs yet.
const DEFAULT_ORG_SLUG = "figbloom";

export default async function RootPage() {
  const userId = await getCurrentUserId();
  redirect(userId ? `/o/${DEFAULT_ORG_SLUG}` : "/login");
}
