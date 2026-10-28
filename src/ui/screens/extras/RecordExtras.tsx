"use client";

import { Banner } from "../../components/basics";
import { AttachmentsSection } from "./Attachments";
import { CommentsSection } from "./Comments";
import { CustomFieldsSection } from "./CustomFields";
import { TagsSection } from "./Tags";
import { FollowCard, HealthCard, ScoreCard } from "./TopCards";

export type ExtrasKind = "lead" | "contact" | "company" | "deal";

export interface RecordExtrasProps {
  kind: ExtrasKind;
  id: string;
  /** An archived record is read-only: nothing here can be changed until it is restored. */
  archived?: boolean;
  /** A screen that already explains the lead score itself (the lead page has "Why this score") turns the card off so it is not shown twice. */
  showScore?: boolean;
}

/**
 * The shared record-extras panel (F3.08, design X1), mounted on leads, contacts, companies and deals. One component, one behaviour: score or
 * health and follow on top, then tags, custom fields, attachments and internal comments. Each part reads its own endpoint and says in words
 * when the API will not give it to the signed-in role, so a part is never just missing.
 *
 * Score is a lead thing and health a company thing, because those are the only records the API scores; the other record types simply have
 * no score card.
 */
export function RecordExtras({ kind, id, archived = false, showScore = true }: RecordExtrasProps) {
  return (
    <div className="fb-extras" data-kind={kind}>
      {archived ? <Banner tone="neutral">Tags, custom fields, files and comments are read-only until this record is restored.</Banner> : null}
      <div className="fb-extras__top">
        {kind === "lead" && showScore ? <ScoreCard id={id} /> : null}
        {kind === "company" ? <HealthCard id={id} /> : null}
        <FollowCard kind={kind} id={id} archived={archived} />
      </div>
      <div className="fb-extras__grid">
        <TagsSection kind={kind} id={id} archived={archived} />
        <CustomFieldsSection kind={kind} id={id} archived={archived} />
        <AttachmentsSection kind={kind} id={id} archived={archived} />
        <CommentsSection kind={kind} id={id} archived={archived} />
      </div>
    </div>
  );
}
