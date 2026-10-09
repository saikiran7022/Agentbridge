interface Rule {
  name: string;
  pattern: RegExp;
  replace?: (match: string, ...groups: string[]) => string;
}

const MASK = "[REDACTED]";

const RULES: Rule[] = [
  { name: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    name: "aws-secret-key",
    pattern: /(aws_secret_access_key\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}/gi,
    replace: (_m, prefix) => `${prefix}${MASK}`,
  },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { name: "hub-token", pattern: /\bhub_[A-Za-z0-9_-]{32,}\b/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: "url-credentials",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi,
    replace: (_m, prefix, _secret, at) => `${prefix}${MASK}${at}`,
  },
  {
    name: "bearer",
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
    replace: (_m, prefix) => `${prefix}${MASK}`,
  },
  {
    name: "assignment",
    pattern:
      /\b((?:password|passwd|pwd|secret|client_secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)["']?\s*[:=]\s*)(["']?)([^\s"',;]{6,})\2/gi,
    replace: (_m, prefix, quote) => `${prefix}${quote}${MASK}${quote}`,
  },
];

export interface RedactionResult {
  text: string;
  redactions: string[];
}

/** Masks credentials so they never reach GitHub, the database or another team's agent. */
export function redactSecrets(input: string): RedactionResult {
  let text = input;
  const redactions: string[] = [];
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args) => {
      redactions.push(rule.name);
      const [match, ...rest] = args as string[];
      return rule.replace ? rule.replace(match, ...rest) : MASK;
    });
  }
  return { text, redactions };
}

export function redact(input: string): string {
  return redactSecrets(input).text;
}
