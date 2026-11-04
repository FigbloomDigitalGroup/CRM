import { z } from "zod";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { answerSurvey, openSurvey } from "@/services/ticketService";

const Schema = z.strictObject({
  score: z.number({ error: "score is required (1 to 5)." }),
  comment: z.string().nullable().optional(),
});

// The customer's side of a satisfaction survey (FIG-1155). No sign-in: the token in the emailed link is the secret. Rate limited per address;
// an unknown link says "unknown" and shows nothing. The answer holds a score and an optional comment, nothing about the customer.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleRoute(async () => openSurvey((await params).token, getClientIp(request)));
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    return answerSurvey((await params).token, body, getClientIp(request));
  });
}
