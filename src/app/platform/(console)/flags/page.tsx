import { notFound } from "next/navigation";

/** V2 (FIG-1192): not part of the first release. The address answers the console's ordinary 404 and the navigation does not link to it. */
export default function Page() {
  notFound();
}
