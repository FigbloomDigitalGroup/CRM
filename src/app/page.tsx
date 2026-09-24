import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/auth/requestContext";

// V1 has exactly one organization (FigBloom itself -- FIG-436 section 2,
// "V1 supports the FigBloom internal CRM first"), so this skips straight to
// it rather than building an organization picker that nothing needs yet.
const DEFAULT_ORG_SLUG = "figbloom";

export default async function RootPage() {
  const userId = await getCurrentUserId();
  redirect(userId ? `/o/${DEFAULT_ORG_SLUG}` : "/dev-login");
}
