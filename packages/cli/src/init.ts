import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import type { HubApi, HubSkillFile } from "@hub/mcp";

export type Transport = "stdio" | "http";

export interface InitOptions {
  project: string;
  dir: string;
  transport: Transport;
  /** Command used to launch `hub mcp` for the stdio transport. */
  command: { command: string; args: string[] };
  claudeMd?: boolean;
}

export interface InitResult {
  mcpJson: string;
  skills: string[];
  claudeMd: string | null;
}

const CLAUDE_MARKER = "<!-- agent-liaison-hub -->";

export async function onPath(bin: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        await access(join(dir, bin + ext), constants.X_OK);
        return true;
      } catch {
        // keep looking
      }
    }
  }
  return false;
}

/** `hub mcp` if the CLI is installed on PATH, otherwise the absolute path of this script. */
export async function stdioCommand(): Promise<{ command: string; args: string[] }> {
  if (await onPath("hub")) return { command: "hub", args: ["mcp"] };
  return { command: process.execPath, args: [resolve(process.argv[1] ?? "hub"), "mcp"] };
}

export function mcpServerEntry(hubUrl: string, opts: Pick<InitOptions, "project" | "transport" | "command">) {
  if (opts.transport === "http") {
    return {
      type: "http",
      url: `${hubUrl.replace(/\/$/, "")}/api/mcp`,
      headers: { Authorization: "Bearer ${HUB_TOKEN}", "X-Hub-Project": opts.project },
    };
  }
  return { type: "stdio", command: opts.command.command, args: opts.command.args, env: { HUB_PROJECT: opts.project } };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`${path} exists but is not valid JSON; fix or remove it first.`);
  }
}

function skillFile(skill: HubSkillFile): string {
  const yamlString = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim());
  return `---\nname: ${skill.slug}\ndescription: ${yamlString(skill.description || skill.name)}\n---\n\n${skill.content.trim()}\n`;
}

function claudeSection(project: string, teams: string): string {
  return `${CLAUDE_MARKER}
## Other teams (Agent Liaison Hub)

This repo is part of the Hub project \`${project}\`. When you need something another team owns (${teams}),
use the \`hub\` MCP tools (\`ask\`, \`wait_for\`, \`follow_up\`) instead of asking the user to contact people.
See the \`hub-liaison\` skill for details.
${CLAUDE_MARKER}
`;
}

/** Writes `.mcp.json`, the project's skills and a CLAUDE.md pointer for one repository. */
export async function initRepository(api: HubApi, opts: InitOptions): Promise<InitResult> {
  const bootstrap = await api.bootstrap(opts.project);
  const dir = resolve(opts.dir);

  const mcpPath = join(dir, ".mcp.json");
  const mcp = await readJson(mcpPath);
  const servers = (mcp.mcpServers && typeof mcp.mcpServers === "object" ? mcp.mcpServers : {}) as Record<string, unknown>;
  servers.hub = mcpServerEntry(bootstrap.hubUrl, opts);
  mcp.mcpServers = servers;
  await writeFile(mcpPath, JSON.stringify(mcp, null, 2) + "\n");

  const skills: string[] = [];
  for (const skill of bootstrap.skills) {
    const skillDir = join(dir, ".claude", "skills", skill.slug);
    await mkdir(skillDir, { recursive: true });
    const path = join(skillDir, "SKILL.md");
    await writeFile(path, skillFile(skill));
    skills.push(path);
  }

  let claudeMd: string | null = null;
  if (opts.claudeMd !== false) {
    claudeMd = join(dir, "CLAUDE.md");
    let existing = "";
    try {
      existing = await readFile(claudeMd, "utf8");
    } catch {
      // new file
    }
    const projects = await api.listProjects().catch(() => []);
    const teams = projects.find((p) => p.slug === opts.project)?.teams.map((t) => t.key).join(", ") || "infra, devops, security...";
    const section = claudeSection(opts.project, teams);
    const pattern = new RegExp(`${CLAUDE_MARKER}[\\s\\S]*?${CLAUDE_MARKER}\\n?`);
    const next = pattern.test(existing)
      ? existing.replace(pattern, section)
      : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${existing ? "\n" : ""}${section}`;
    await writeFile(claudeMd, next);
  }

  return { mcpJson: mcpPath, skills, claudeMd };
}
