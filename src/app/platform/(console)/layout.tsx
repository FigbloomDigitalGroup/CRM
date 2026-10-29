import { PlatformShell } from "@/ui/screens/platform";
import { PlatformSignOut } from "../PlatformSignOut";
import { requireConsole } from "../requireConsole";

/** The console shell (PL1, TB6): navigation, top bar, identity. Separate from the organisation app and carrying no tenant data. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireConsole();
  return (
    <PlatformShell identity={identity} signOut={<PlatformSignOut className="fb-pl-menu-item fb-pl-menu-item--danger">Sign out</PlatformSignOut>}>
      {children}
    </PlatformShell>
  );
}
