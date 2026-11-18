"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMember } from "../../../data/member";
import { Icon } from "../../leads/icons";
import { MergeDialog, type MergeKind } from "./MergeDialog";

/** The merge flow as its own page: the dialog over a quiet frame. Closing it goes back to where the person came from. */
export function MergeScreen({ kind, id }: { kind: MergeKind; id: string }) {
  const { orgSlug, can } = useMember();
  const router = useRouter();
  const noun = kind === "company" ? "companies" : kind === "contact" ? "contacts" : "leads";
  const needs = kind === "company" ? "companies.merge" : kind === "contact" ? "contacts.merge" : null;
  const allowed = needs === null || can(needs);
  return (
    <div className="fb-cu" data-screen-label="Merge duplicates">
      <Link href={`/o/${orgSlug}/${noun}`} className="fb-cu-back">
        <Icon name="arrow-left" size={15} />
        {noun.charAt(0).toUpperCase() + noun.slice(1)}
      </Link>
      <h1 className="fb-cu-title">Merge duplicates</h1>
      {!id ? (
        <p role="alert">Open a record and choose Merge to start.</p>
      ) : !allowed ? (
        <div className="fb-cu-card fb-cu-state" role="alert">
          <div className="fb-cu-state__title">Your role cannot merge {noun}</div>
          <div className="fb-cu-state__body">Merging is for Management and Sales. Ask one of them to merge these records.</div>
        </div>
      ) : (
        <MergeDialog kind={kind} id={id} onClose={() => router.back()} onMerged={() => undefined} />
      )}
    </div>
  );
}
