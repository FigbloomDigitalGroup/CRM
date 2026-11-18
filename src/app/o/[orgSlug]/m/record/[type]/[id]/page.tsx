import { notFound } from "next/navigation";
import { RecordScreen, type RecordType } from "@/ui/screens/mobile/RecordScreen";

const TYPES: RecordType[] = ["lead", "contact", "company", "deal"];

/** One lead, person, company or deal on the phone (M2). */
export default async function MobileRecordPage({ params }: { params: Promise<{ orgSlug: string; type: string; id: string }> }) {
  const { type, id } = await params;
  if (!TYPES.includes(type as RecordType)) notFound();
  return <RecordScreen type={type as RecordType} id={id} />;
}
