import { checkOwnColours, OWN_COLOUR_FIELDS, type ColourProblem, type OwnColourField, type OwnColours } from "@/preferences/catalogue";
import { bestTextOn, contrastRatio, isHexColour, normaliseHex } from "@/preferences/contrast";
import { AA_TEXT } from "./palette";
import { ensureContrast, readableOn } from "./color";

/**
 * Your own colours (AP4, FIG-1176): the pure part. The same check the server runs before it stores them (`checkOwnColours`), plus what the
 * preview needs: the button colour the theme engine will derive, the sidebar text that will be used, and a suggested fix for every colour
 * that would read below AA. `canSave` is true only when the server would accept the set, so no combination below AA can be saved.
 */

export type OwnDraft = Record<OwnColourField, string>;

export const OWN_LABELS: Record<OwnColourField, string> = { sidebar: "Sidebar colour", accent: "Accent colour", highlight: "Highlight dot", page: "Page colour" };

export interface OwnFieldReport {
  field: OwnColourField;
  label: string;
  value: string;
  valid: boolean;
  /** Something the person should know (a problem, or what the theme engine will do), in plain words. */
  note: string | null;
  /** This colour on its own would be refused. */
  blocked: boolean;
  /** A nearby colour that does pass, when there is one. */
  suggestion: string | null;
}

export interface OwnReport {
  fields: OwnFieldReport[];
  problems: ColourProblem[];
  canSave: boolean;
  /** What the preview paints. Buttons are darkened until white text reads on them. */
  preview: { sidebar: string; sidebarText: string; page: string; button: string; dot: string; buttonDarkened: boolean };
  /** The set to send to the server: normalised, upper case. Empty when nothing is valid. */
  colours: OwnColours;
}

/** The colours the member's theme and page colour resolve to: the base the check judges only the changed fields against. */
export interface OwnBase {
  sidebar: string;
  accent: string;
  highlight: string;
  page: string;
}

export function isChanged(draft: OwnDraft, base: OwnBase): boolean {
  return OWN_COLOUR_FIELDS.some((f) => draft[f].trim().toUpperCase() !== base[f].toUpperCase());
}

function suggest(field: OwnColourField, draft: OwnDraft): string | null {
  const page = isHexColour(draft.page) ? draft.page : "#FFFFFF";
  const pageText = bestTextOn(page).colour;
  let fix: string;
  switch (field) {
    case "accent":
      fix = ensureContrast(draft.accent, [page], AA_TEXT);
      break;
    case "highlight":
      // The highlight sits behind text: move it away from the text colour, toward the page.
      fix = ensureContrast(draft.highlight, [pageText === "#111827" ? "#111827" : "#F9FAFB"], AA_TEXT);
      break;
    case "sidebar":
    case "page": {
      // Moved toward white or black until the text that goes on it reads.
      const white = ensureContrast(draft[field], ["#111827"], AA_TEXT);
      const black = ensureContrast(draft[field], ["#F9FAFB"], AA_TEXT);
      fix = bestTextOn(white).ratio >= AA_TEXT ? white : black;
      break;
    }
  }
  return normaliseHex(fix) === normaliseHex(draft[field]) ? null : normaliseHex(fix);
}

export function evaluateOwnColours(draft: OwnDraft, base: OwnBase): OwnReport {
  const entered: Record<string, unknown> = {};
  for (const f of OWN_COLOUR_FIELDS) if (draft[f].trim() !== "") entered[f] = draft[f].trim();
  const { colours, problems } = checkOwnColours(entered, base);

  const fields = OWN_COLOUR_FIELDS.map<OwnFieldReport>((field) => {
    const value = draft[field].trim();
    const valid = isHexColour(value);
    const problem = problems.find((p) => p.field === field);
    let note: string | null = null;
    if (!valid) note = "Use a 6-digit hex like #275B3A.";
    else if (problem?.code === "COLOUR_LOW_CONTRAST") {
      note =
        field === "page"
          ? "Too close to mid-grey: neither dark nor light text reads well on it. Pick a lighter or darker page colour."
          : field === "accent"
            ? "Too light against your page to read as text or a link."
            : field === "highlight"
              ? "Text on this highlight would be hard to read."
              : "Text on this sidebar would be hard to read.";
    } else if (field === "accent" && contrastRatio(value, "#FFFFFF") < AA_TEXT) {
      note = `Too light for white button text. Buttons use ${normaliseHex(ensureContrast(value, ["#FFFFFF"], AA_TEXT))} instead.`;
    } else if (field === "sidebar" && readableOn(value) !== "#FFFFFF") {
      note = "Light sidebar: menu text switches to dark.";
    }
    return { field, label: OWN_LABELS[field], value, valid, note, blocked: !valid || Boolean(problem), suggestion: valid && problem ? suggest(field, draft) : null };
  });

  const eff = (f: OwnColourField) => (isHexColour(draft[f]) ? normaliseHex(draft[f]) : base[f].toUpperCase());
  const accent = eff("accent");
  const button = normaliseHex(ensureContrast(accent, ["#FFFFFF"], AA_TEXT));
  const sidebar = eff("sidebar");
  return {
    fields,
    problems,
    canSave: problems.length === 0 && fields.every((f) => f.valid),
    preview: { sidebar, sidebarText: ensureContrast(readableOn(sidebar), [sidebar], AA_TEXT), page: eff("page"), button, dot: eff("highlight"), buttonDarkened: button !== accent },
    colours,
  };
}
