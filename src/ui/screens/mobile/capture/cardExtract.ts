/**
 * Business-card reading (M4, FIG-1177). Demo only: it does not read the photo. It returns a sample card so the confirm step can be shown; the
 * real extraction arrives with B6.22 (M13). Whatever comes back is only ever offered as a suggestion: the person checks every field before
 * saving, and fields the reader was unsure about are flagged.
 */

export interface ExtractedCard {
  name: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  /** Fields the reader was not sure of, so the person is asked to check them. */
  unsure: ("name" | "company" | "title" | "phone" | "email")[];
}

const SAMPLES: ExtractedCard[] = [
  { name: "Achieng Otieno", company: "Lakeview Hotels", title: "Marketing Manager", phone: "+254 722 410 088", email: "achieng@lakeview.co.ke", unsure: ["phone"] },
  { name: "Peter Kamau", company: "Kamau and Sons Ltd", title: "Director", phone: "+254 733 120 455", email: "peter@kamauandsons.co.ke", unsure: ["email"] },
  { name: "Fatuma Hassan", company: "Mombasa Fresh", title: "Operations Lead", phone: "+254 711 903 276", email: "fatuma@mombasafresh.co.ke", unsure: [] },
];

let next = 0;

export async function extractCard(_photo: Blob | File | null): Promise<ExtractedCard> {
  const card = SAMPLES[next % SAMPLES.length]!;
  next += 1;
  return { ...card, unsure: [...card.unsure] };
}

/** The sentence that goes above the form after a scan. */
export function scanSummary(card: ExtractedCard): string {
  const check = card.unsure.length ? ` Not sure about the ${card.unsure.join(" and ")}.` : "";
  return `Read “${card.name}” from the card.${check} Check the fields before saving.`;
}

/** What goes into the capture form: only what the form has a place for. The job title and company go in the note so nothing is lost. */
export function cardToCapture(card: ExtractedCard): { name: string; phone: string; email: string; note: string } {
  return { name: card.company || card.name, phone: card.phone, email: card.email, note: `${card.name}${card.title ? `, ${card.title}` : ""}. From a business card.` };
}
