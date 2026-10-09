import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hubLiaisonSkill, type HubApi } from "@hub/mcp";
import { readConfig, resolveCredentials, writeConfig } from "../src/config.js";
import { initRepository } from "../src/init.js";
import { browserLogin } from "../src/login.js";

function fakeApi(): HubApi {
  const notUsed = () => Promise.reject(new Error("not used"));
  return {
    me: async () => ({ login: "alice", name: null }),
    listProjects: async () => [
      {
        slug: "payments",
        name: "Payments",
        description: "",
        myRole: "CONTRIBUTOR",
        myTeam: "dev",
        routerEnabled: true,
        teams: [
          { key: "dev", name: "Dev", description: "", agent: null, people: [] },
          { key: "infra", name: "Infra", description: "", agent: null, people: [] },
        ],
      },
    ],
    bootstrap: async (project) => ({
      hubUrl: "https://hub.example.com",
      project: { slug: project, name: "Payments" },
      skills: [hubLiaisonSkill(project), { slug: "runbooks", name: "Runbooks", description: "Where runbooks live", content: "# Runbooks\nSee /docs." }],
    }),
    ask: notUsed,
    getRequest: notUsed,
    waitFor: notUsed,
    myRequests: notUsed,
    inbox: notUsed,
    reply: notUsed,
    approve: notUsed,
    reject: notUsed,
    close: notUsed,
  };
}

describe("hub init", () => {
  it("merges .mcp.json, installs skills and adds a CLAUDE.md section once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hub-init-"));
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    await writeFile(join(dir, "CLAUDE.md"), "# My repo\n");
    const opts = { project: "payments", dir, transport: "stdio" as const, command: { command: "hub", args: ["mcp"] } };

    const result = await initRepository(fakeApi(), opts);
    await initRepository(fakeApi(), opts);

    const mcp = JSON.parse(await readFile(result.mcpJson, "utf8"));
    expect(mcp.mcpServers.other).toEqual({ command: "x" });
    expect(mcp.mcpServers.hub).toEqual({ type: "stdio", command: "hub", args: ["mcp"], env: { HUB_PROJECT: "payments" } });

    expect(result.skills).toHaveLength(2);
    const skill = await readFile(join(dir, ".claude/skills/hub-liaison/SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: hub-liaison\ndescription: ".+"\n---\n/);
    expect(skill).toContain("payments");

    const claude = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(claude.startsWith("# My repo\n")).toBe(true);
    expect(claude.match(/Agent Liaison Hub/g)).toHaveLength(1);
    expect(claude).toContain("dev, infra");
  });

  it("writes an http entry that reads the token from the environment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hub-init-"));
    const result = await initRepository(fakeApi(), {
      project: "payments",
      dir,
      transport: "http",
      command: { command: "hub", args: ["mcp"] },
      claudeMd: false,
    });
    const mcp = JSON.parse(await readFile(result.mcpJson, "utf8"));
    expect(mcp.mcpServers.hub).toEqual({
      type: "http",
      url: "https://hub.example.com/api/mcp",
      headers: { Authorization: "Bearer ${HUB_TOKEN}", "X-Hub-Project": "payments" },
    });
    expect(result.claudeMd).toBeNull();
  });
});

describe("hub login", () => {
  it("receives the token on the loopback callback and checks state", async () => {
    let authorizeUrl = "";
    const done = browserLogin("https://hub.example.com", {
      open: (u) => {
        authorizeUrl = u;
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const url = new URL(authorizeUrl);
    expect(url.pathname).toBe("/cli/authorize");
    const callback = new URL(url.searchParams.get("callback")!);

    const bad = await fetch(`${callback}?token=t&state=wrong`);
    expect(bad.status).toBe(400);

    callback.searchParams.set("token", "hub_abc");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    callback.searchParams.set("login", "alice");
    expect((await fetch(callback)).status).toBe(200);
    await expect(done).resolves.toEqual({ token: "hub_abc", login: "alice" });
  });

  it("stores credentials privately and lets env vars override them", async () => {
    const env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "hub-cfg-")) } as NodeJS.ProcessEnv;
    await writeConfig({ url: "https://hub.example.com", token: "hub_saved", login: "alice" }, env);
    expect(await readConfig(env)).toEqual({ url: "https://hub.example.com", token: "hub_saved", login: "alice" });
    expect(await resolveCredentials({ ...env, HUB_TOKEN: "hub_env" })).toEqual({ url: "https://hub.example.com", token: "hub_env" });
  });
});
