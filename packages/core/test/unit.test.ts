import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractA2AResult } from "../src/a2a";
import { parseCommentCommand } from "../src/commands";
import { matchCategory, verifyWebhookSignature } from "../src/github";
import { parseHubResult } from "../src/hub-result";
import { decideOutcome } from "../src/policy";
import { redact, redactSecrets } from "../src/redact";

describe("redactSecrets", () => {
  it("masks common credential formats", () => {
    const input = [
      "aws key AKIAABCDEFGHIJKLMNOP",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "db postgres://app:s3cretPass@db.internal:5432/app",
      "password = hunter22222",
      'api_key: "abcd1234efgh"',
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
      "anthropic sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    ].join("\n");
    const { text, redactions } = redactSecrets(input);
    expect(text).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(text).not.toContain("s3cretPass");
    expect(text).toContain("postgres://app:[REDACTED]@db.internal:5432/app");
    expect(text).not.toContain("hunter22222");
    expect(text).not.toContain("abcd1234efgh");
    expect(text).not.toContain("MIIEowIBAAKCAQEA");
    expect(text).not.toContain("sk-ant-api03");
    expect(text).toContain("Bearer [REDACTED]");
    expect(redactions.length).toBeGreaterThanOrEqual(8);
  });

  it("leaves ordinary text and secret references alone", () => {
    const ok = "The staging DB password lives in Vault at secret/data/payments/staging/db (key: password).";
    expect(redact(ok)).toBe(ok);
  });
});

describe("parseHubResult", () => {
  it("parses the structured block and keeps the narrative", () => {
    const r = parseHubResult(
      'The bucket is in us-east-1.\n<hub-result>\n{"status":"answered","confidence":0.92,"answer":"s3://payments-artifacts (us-east-1)","department":"Infra"}\n</hub-result>',
    );
    expect(r).toMatchObject({ status: "answered", confidence: 0.92, answer: "s3://payments-artifacts (us-east-1)", department: "infra", structured: true });
    expect(r.narrative).toBe("The bucket is in us-east-1.");
  });

  it("accepts fenced JSON and uses the last block", () => {
    const r = parseHubResult(
      '<hub-result>{"status":"needs_human","confidence":0}</hub-result>\nretry\n<hub-result>```json\n{"status":"needs_approval","confidence":"0.8","answer":"x","proposed_action":"grant role"}\n```</hub-result>',
    );
    expect(r.status).toBe("needs_approval");
    expect(r.confidence).toBe(0.8);
    expect(r.proposedAction).toBe("grant role");
  });

  it("falls back to needs_human when the block is missing or invalid", () => {
    expect(parseHubResult("I think it's in config.yaml")).toMatchObject({ status: "needs_human", structured: false, answer: "I think it's in config.yaml" });
    expect(parseHubResult("<hub-result>{not json</hub-result>").structured).toBe(false);
  });
});

describe("decideOutcome", () => {
  const base = { narrative: "", structured: true } as const;

  it("answers when confident", () => {
    const d = decideOutcome({ result: { ...base, status: "answered", confidence: 0.9, answer: "yes" }, autonomy: "READ_ONLY", confidenceThreshold: 0.7 });
    expect(d).toEqual({ kind: "answer", answer: "yes", confidence: 0.9 });
  });

  it("escalates low-confidence answers with the draft", () => {
    const d = decideOutcome({ result: { ...base, status: "answered", confidence: 0.4, answer: "maybe" }, autonomy: "READ_ONLY", confidenceThreshold: 0.7 });
    expect(d).toMatchObject({ kind: "escalate", draft: "maybe" });
  });

  it("routes changes to a person for read-only agents and to approval otherwise", () => {
    const result = { ...base, status: "needs_approval" as const, confidence: 0.8, answer: "", proposedAction: "add IAM role" };
    expect(decideOutcome({ result, autonomy: "READ_ONLY", confidenceThreshold: 0.7 })).toMatchObject({ kind: "escalate", proposedAction: "add IAM role" });
    expect(decideOutcome({ result, autonomy: "APPROVAL_FOR_WRITES", confidenceThreshold: 0.7 })).toMatchObject({ kind: "approval", proposedAction: "add IAM role" });
    expect(decideOutcome({ result, autonomy: "APPROVAL_FOR_WRITES", confidenceThreshold: 0.7, executing: true }).kind).toBe("escalate");
  });

  it("never trusts unstructured output", () => {
    expect(decideOutcome({ result: { ...base, structured: false, status: "needs_human", confidence: 0, answer: "x" }, autonomy: "AUTONOMOUS", confidenceThreshold: 0 }).kind).toBe("escalate");
  });
});

describe("parseCommentCommand", () => {
  it("recognises slash commands", () => {
    expect(parseCommentCommand("/approve looks good")).toEqual({ kind: "approve", note: "looks good" });
    expect(parseCommentCommand("/reject too broad\nuse a narrower role")).toEqual({ kind: "reject", reason: "too broad\nuse a narrower role" });
    expect(parseCommentCommand("/CLOSE")).toEqual({ kind: "close" });
    expect(parseCommentCommand("It's in vault at secret/x")).toEqual({ kind: "message", body: "It's in vault at secret/x" });
    expect(parseCommentCommand("please /approve")).toMatchObject({ kind: "message" });
  });
});

describe("extractA2AResult", () => {
  it("reads artifacts from a completed task", () => {
    const out = extractA2AResult({
      kind: "task",
      id: "t1",
      contextId: "c1",
      status: { state: "completed" },
      artifacts: [{ parts: [{ kind: "text", text: "hello" }, { kind: "data", data: {} }] }],
      metadata: { kagent_usage_metadata: { totalTokenCount: 1234 } },
    });
    expect(out).toEqual({ text: "hello", contextId: "c1", taskId: "t1", state: "completed", totalTokens: 1234 });
  });

  it("falls back to the status message and history", () => {
    expect(extractA2AResult({ kind: "task", status: { state: "input-required", message: { parts: [{ kind: "text", text: "approve?" }] } } }).text).toBe("approve?");
    expect(
      extractA2AResult({ kind: "task", status: { state: "completed" }, history: [{ role: "user", parts: [{ kind: "text", text: "q" }] }, { role: "agent", parts: [{ kind: "text", text: "a" }] }] }).text,
    ).toBe("a");
    expect(extractA2AResult({ kind: "message", parts: [{ kind: "text", text: "direct" }], contextId: "c2" })).toMatchObject({ text: "direct", contextId: "c2" });
  });
});

describe("GitHub helpers", () => {
  it("verifies webhook signatures", () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyWebhookSignature(body, sig, "other")).toBe(false);
    expect(verifyWebhookSignature(body, undefined, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, sig, "")).toBe(false);
  });

  it("matches department categories with a fallback", () => {
    const cats = [
      { id: "1", name: "General", slug: "general" },
      { id: "2", name: "Infrastructure", slug: "infrastructure" },
      { id: "3", name: "Sec", slug: "security" },
    ];
    expect(matchCategory(cats, { key: "infra", name: "Infrastructure" }, "General")).toEqual({ category: cats[1], usedFallback: false });
    expect(matchCategory(cats, { key: "security", name: "Security" }, "General").category?.id).toBe("3");
    expect(matchCategory(cats, { key: "devops", name: "DevOps" }, "General")).toEqual({ category: cats[0], usedFallback: true });
  });
});

describe("extractA2AResult with a paused ask_user task", () => {
  it("returns the question the agent asked instead of empty text", () => {
    const out = extractA2AResult({
      kind: "task",
      id: "t1",
      contextId: "c1",
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [
            {
              kind: "data",
              data: {
                name: "adk_request_confirmation",
                args: {
                  originalFunctionCall: { name: "ask_user", args: { questions: [{ question: "Which cluster?" }] } },
                  toolConfirmation: { confirmed: false, hint: "Which cluster?" },
                },
              },
            },
          ],
        },
      },
    });
    expect(out.state).toBe("input-required");
    expect(out.text).toBe("Which cluster?");
  });
});
