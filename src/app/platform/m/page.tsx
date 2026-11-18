import { PlatformMobile } from "@/ui/screens/platform";
import { PlatformSignOut } from "../PlatformSignOut";

export default function Page() {
  return <PlatformMobile tab="home" signOut={<PlatformSignOut className="fb-pl-m-pill">Sign out</PlatformSignOut>} />;
}
