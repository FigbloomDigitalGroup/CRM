import { ErrorState } from "@/ui/components/states";

/** A record or page that does not exist (or is not in this organisation), inside the shell. */
export default function OrgNotFound() {
  return (
    <div className="fb-page-detail">
      <ErrorState error={{ status: 404 }} />
    </div>
  );
}
