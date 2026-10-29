import { requireConsole } from "../requireConsole";

/** Platform mobile (PLM) sits beside the desktop console, behind the same door, without the desktop shell. */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  await requireConsole();
  return children;
}
