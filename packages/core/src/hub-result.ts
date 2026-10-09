import { z } from "zod";
import { HUB_RESULT_TAG } from "@hub/agent-templates";

const resultSchema = z.object({
  status: z.enum(["answered", "needs_human", "needs_approval"]),
  confidence: z.coerce.number().min(0).max(1).catch(0),
  answer: z.string().optional().default(""),
  proposed_action: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
});

export interface HubResult {
  status: "answered" | "needs_human" | "needs_approval";
  confidence: number;
  answer: string;
  proposedAction?: string;
  reason?: string;
  department?: string;
  /** Prose the agent wrote before the structured block. */
  narrative: string;
  /** False when the agent did not return a valid block and we fell back to defaults. */
  structured: boolean;
}

const BLOCK_RE = new RegExp(`<${HUB_RESULT_TAG}>([\\s\\S]*?)</${HUB_RESULT_TAG}>`, "g");

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("no JSON object found");
  }
}

/** Parses the structured block every liaison agent is instructed to end its reply with. */
export function parseHubResult(text: string): HubResult {
  const matches = [...text.matchAll(BLOCK_RE)];
  const last = matches.at(-1);
  const narrative = (last ? text.slice(0, last.index) : text).trim();
  if (last) {
    try {
      const parsed = resultSchema.parse(extractJson(last[1]));
      return {
        status: parsed.status,
        confidence: parsed.confidence,
        answer: parsed.answer.trim() || narrative,
        proposedAction: parsed.proposed_action?.trim() || undefined,
        reason: parsed.reason?.trim() || undefined,
        department: parsed.department?.trim().toLowerCase() || undefined,
        narrative,
        structured: true,
      };
    } catch {
      // fall through to the unstructured fallback
    }
  }
  return {
    status: "needs_human",
    confidence: 0,
    answer: narrative,
    reason: "The agent did not return a structured result",
    narrative,
    structured: false,
  };
}
