import { redirect } from "next/navigation";

/**
 * OS1 (FIG-1166). The organisation layout renders the paused screen in place of the shell while the organisation is suspended, so this page
 * is only reached when it is not: send the person to their home.
 */
export default async function SuspendedPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  redirect(`/o/${orgSlug}`);
}
