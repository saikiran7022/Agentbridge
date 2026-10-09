import { parseArgs } from "node:util";
import {
  formatProjects,
  formatRequest,
  formatRequestList,
  HttpHubApi,
  HubApiError,
  runStdio,
} from "@hub/mcp";
import { clearConfig, configPath, readConfig, resolveCredentials, writeConfig } from "./config.js";
import { initRepository, stdioCommand, type Transport } from "./init.js";
import { browserLogin } from "./login.js";

const VERSION = "0.1.0";

const HELP = `hub - Agent Liaison Hub CLI

Usage:
  hub login [--url <hub url>] [--token <api token>]   Log in (opens your browser unless --token is given)
  hub logout                                         Forget the saved token
  hub whoami                                         Show the logged-in user
  hub projects                                       List your projects and their teams
  hub init --project <slug> [--transport stdio|http] [--dir <path>] [--no-claude-md]
                                                     Configure this repository for Claude Code
  hub ask --project <slug> [--team <key>] [--wait <seconds>] <question...>
  hub status <request id or number>
  hub inbox                                          Requests waiting on you
  hub mcp                                            Run the hub MCP server over stdio (used by Claude Code)

Environment: HUB_URL and HUB_TOKEN override the saved login; HUB_PROJECT sets the default project for \`hub mcp\`.`;

function fail(message: string): never {
  console.error(`hub: ${message}`);
  process.exit(1);
}

async function client(): Promise<{ api: HttpHubApi; url: string; token: string }> {
  const creds = await resolveCredentials();
  if (!creds) fail("not logged in. Run `hub login --url <hub url>` first.");
  return { api: new HttpHubApi(creds.url, creds.token), ...creds };
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      project: { type: "string", short: "p" },
      team: { type: "string", short: "t" },
      transport: { type: "string" },
      dir: { type: "string" },
      wait: { type: "string" },
      context: { type: "string" },
      "no-claude-md": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    case "--version":
    case "version":
      console.log(VERSION);
      return;

    case "login": {
      const saved = await readConfig();
      const url = (values.url ?? process.env.HUB_URL ?? saved?.url)?.replace(/\/$/, "");
      if (!url) fail("pass --url <hub url>, for example `hub login --url https://hub.example.com`.");
      let token = values.token;
      if (!token) {
        const result = await browserLogin(url, {
          onUrl: (u) => console.log(`Opening your browser to approve this machine. If it does not open, visit:\n  ${u}\n`),
        });
        token = result.token;
      }
      const me = await new HttpHubApi(url, token).me();
      const path = await writeConfig({ url, token, login: me.login });
      console.log(`Logged in to ${url} as ${me.login}. Token saved to ${path}.`);
      return;
    }

    case "logout":
      await clearConfig();
      console.log(`Removed ${configPath()}. Revoke the token in the Hub under "Connect Claude Code" if it may have leaked.`);
      return;

    case "whoami": {
      const { api, url } = await client();
      const me = await api.me();
      console.log(`${me.login}${me.name ? ` (${me.name})` : ""} on ${url}`);
      return;
    }

    case "projects": {
      const { api } = await client();
      console.log(formatProjects(await api.listProjects()));
      return;
    }

    case "init": {
      const { api } = await client();
      let project = values.project;
      if (!project) {
        const projects = await api.listProjects();
        if (projects.length !== 1) {
          fail(projects.length ? `pass --project, one of: ${projects.map((p) => p.slug).join(", ")}` : "you are not on any project yet.");
        }
        project = projects[0]!.slug;
      }
      const transport = (values.transport ?? "stdio") as Transport;
      if (transport !== "stdio" && transport !== "http") fail("--transport must be stdio or http.");
      const result = await initRepository(api, {
        project,
        dir: values.dir ?? process.cwd(),
        transport,
        command: await stdioCommand(),
        claudeMd: !values["no-claude-md"],
      });
      console.log(`Configured project ${project}:`);
      console.log(`  ${result.mcpJson} (hub MCP server, ${transport})`);
      for (const s of result.skills) console.log(`  ${s}`);
      if (result.claudeMd) console.log(`  ${result.claudeMd}`);
      if (transport === "http") console.log("\nExport HUB_TOKEN in the shell that starts Claude Code (see `hub login`).");
      console.log("\nRestart Claude Code, then try: \"Ask infra where the staging database credentials live.\"");
      return;
    }

    case "ask": {
      const { api } = await client();
      const project = values.project ?? process.env.HUB_PROJECT;
      const question = positionals.join(" ").trim();
      if (!project) fail("pass --project <slug>.");
      if (!question) fail("give the question as arguments.");
      let r = await api.ask({ project, team: values.team ?? null, question, context: values.context ?? null, client: "hub CLI" });
      const wait = Number(values.wait ?? 60);
      if (!r.done && wait > 0 && !["ESCALATED", "AWAITING_APPROVAL"].includes(r.status)) r = await api.waitFor(r.id, wait);
      console.log(formatRequest(r));
      return;
    }

    case "status": {
      const id = positionals[0];
      if (!id) fail("give a request id or number.");
      const { api } = await client();
      console.log(formatRequest(await api.getRequest(id), { includeThread: true }));
      return;
    }

    case "inbox": {
      const { api } = await client();
      console.log(formatRequestList(await api.inbox(), "Nothing is waiting on you."));
      return;
    }

    case "mcp": {
      const { url, token } = await client();
      await runStdio({ url, token, project: process.env.HUB_PROJECT ?? values.project ?? null });
      return;
    }

    default:
      fail(`unknown command "${command}". Run \`hub help\`.`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof HubApiError) fail(`${err.message} (HTTP ${err.status})`);
  fail(err instanceof Error ? err.message : String(err));
});
