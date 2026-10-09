import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  url: string;
  token: string;
  login: string;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "agent-liaison-hub", "config.json");
}

export async function readConfig(env: NodeJS.ProcessEnv = process.env): Promise<CliConfig | null> {
  try {
    const data = JSON.parse(await readFile(configPath(env), "utf8")) as Partial<CliConfig>;
    return data.url && data.token ? { url: data.url, token: data.token, login: data.login ?? "" } : null;
  } catch {
    return null;
  }
}

export async function writeConfig(config: CliConfig, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function clearConfig(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await rm(configPath(env), { force: true });
}

/** HUB_URL / HUB_TOKEN override the saved login so CI and containers work without `hub login`. */
export async function resolveCredentials(env: NodeJS.ProcessEnv = process.env): Promise<{ url: string; token: string } | null> {
  const saved = await readConfig(env);
  const url = env.HUB_URL || saved?.url;
  const token = env.HUB_TOKEN || saved?.token;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}
