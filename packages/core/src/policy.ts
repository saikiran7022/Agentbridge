import type { HubResult } from "./hub-result.js";

export type Autonomy = "READ_ONLY" | "APPROVAL_FOR_WRITES" | "AUTONOMOUS";

export type Decision =
  | { kind: "answer"; answer: string; confidence: number }
  | { kind: "approval"; proposedAction: string; answer: string; confidence: number }
  | { kind: "escalate"; reason: string; draft?: string; proposedAction?: string };

export interface DecisionInput {
  result: HubResult;
  autonomy: Autonomy;
  confidenceThreshold: number;
  /** True when this result came from the post-approval execution agent. */
  executing?: boolean;
}

/**
 * Turns an agent's self-reported result into what the Hub actually does.
 * Enforcement of write access lives in which tools each kagent agent gets;
 * this decides who has to look at the result next.
 */
export function decideOutcome({ result, autonomy, confidenceThreshold, executing }: DecisionInput): Decision {
  if (!result.structured) {
    return { kind: "escalate", reason: result.reason ?? "Unstructured agent response", draft: result.answer || undefined };
  }

  if (result.status === "answered") {
    if (!result.answer) return { kind: "escalate", reason: "The agent returned an empty answer" };
    if (result.confidence < confidenceThreshold) {
      return {
        kind: "escalate",
        reason: `Agent confidence ${result.confidence.toFixed(2)} is below the ${confidenceThreshold.toFixed(2)} threshold`,
        draft: result.answer,
      };
    }
    return { kind: "answer", answer: result.answer, confidence: result.confidence };
  }

  if (result.status === "needs_approval") {
    const proposedAction = result.proposedAction || result.answer;
    if (executing) {
      return { kind: "escalate", reason: result.reason ?? "The execution agent asked for more approval", draft: result.answer, proposedAction };
    }
    if (autonomy === "READ_ONLY") {
      return {
        kind: "escalate",
        reason: `This needs a change and the agent is read-only, so a person has to make it. ${result.reason ?? ""}`.trim(),
        draft: result.answer,
        proposedAction,
      };
    }
    return { kind: "approval", proposedAction, answer: result.answer, confidence: result.confidence };
  }

  return { kind: "escalate", reason: result.reason ?? "The agent asked for a human", draft: result.answer || undefined };
}
