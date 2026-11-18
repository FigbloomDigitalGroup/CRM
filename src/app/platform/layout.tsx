import "@/ui/screens/platform/platform.css";
import { PlatformRoot } from "@/ui/screens/platform";

/** The console's own root: its stylesheet, look and demo store. It never loads the tenant stylesheet (tests/uiGuards.test.ts). */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformRoot>{children}</PlatformRoot>;
}
