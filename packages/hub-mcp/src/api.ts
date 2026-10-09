export interface HubMessage {
  id: string;
  author: string;
  authorType: "HUMAN" | "AGENT" | "SYSTEM";
  body: string;
  createdAt: string;
}

export interface HubRequest {
  id: string;
  number: number;
  url: string;
  project: string;
  title: string;
  question: string;
  context: string;
  status: string;
  statusReason: string | null;
  team: string | null;
  teamName: string | null;
  askedBy: string;
  answer: string | null;
  answeredBy: string | null;
  confidence: number | null;
  proposedAction: string | null;
  approvedBy: string | null;
  rejectReason: string | null;
  discussionUrl: string | null;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  done: boolean;
  messages: HubMessage[];
}

export interface HubTeam {
  key: string;
  name: string;
  description: string;
  agent: { enabled: boolean; autonomy: string; status: string } | null;
  people: { login: string; role: string }[];
}

export interface HubProject {
  slug: string;
  name: string;
  description: string;
  myRole: string;
  myTeam: string;
  routerEnabled: boolean;
  teams: HubTeam[];
}

export interface AskInput {
  project: string;
  team?: string | null;
  question: string;
  context?: string | null;
  title?: string | null;
  client?: string | null;
}

export interface HubSkillFile {
  slug: string;
  name: string;
  description: string;
  content: string;
}

export interface HubBootstrap {
  hubUrl: string;
  project: { slug: string; name: string };
  skills: HubSkillFile[];
}

/** Everything hub-mcp and the CLI need from the Hub, implemented over HTTP or in-process. */
export interface HubApi {
  me(): Promise<{ login: string; name: string | null }>;
  listProjects(): Promise<HubProject[]>;
  ask(input: AskInput): Promise<HubRequest>;
  getRequest(id: string): Promise<HubRequest>;
  waitFor(id: string, timeoutSeconds: number): Promise<HubRequest>;
  myRequests(status?: string): Promise<HubRequest[]>;
  inbox(): Promise<HubRequest[]>;
  reply(id: string, body: string): Promise<HubRequest>;
  approve(id: string, note?: string): Promise<HubRequest>;
  reject(id: string, reason: string): Promise<HubRequest>;
  close(id: string): Promise<HubRequest>;
  bootstrap(project: string): Promise<HubBootstrap>;
}

export class HubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class HttpHubApi implements HubApi {
  private readonly base: string;

  constructor(
    url: string,
    private readonly token: string,
  ) {
    this.base = url.replace(/\/$/, "");
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    const res = await fetch(`${this.base}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      throw new HubApiError(res.status, (data as { error?: string })?.error ?? `Hub returned HTTP ${res.status}`);
    }
    return data as T;
  }

  me() {
    return this.call<{ login: string; name: string | null }>("GET", "/me");
  }
  listProjects() {
    return this.call<HubProject[]>("GET", "/projects");
  }
  ask(input: AskInput) {
    const { project, ...rest } = input;
    return this.call<HubRequest>("POST", `/projects/${encodeURIComponent(project)}/requests`, rest);
  }
  getRequest(id: string) {
    return this.call<HubRequest>("GET", `/requests/${encodeURIComponent(id)}`);
  }
  waitFor(id: string, timeoutSeconds: number) {
    const t = Math.min(Math.max(Math.round(timeoutSeconds), 0), 120);
    return this.call<HubRequest>("GET", `/requests/${encodeURIComponent(id)}/wait?timeout=${t}`, undefined, (t + 15) * 1000);
  }
  myRequests(status?: string) {
    return this.call<HubRequest[]>("GET", `/requests${status ? `?status=${encodeURIComponent(status)}` : ""}`);
  }
  inbox() {
    return this.call<HubRequest[]>("GET", "/inbox");
  }
  reply(id: string, body: string) {
    return this.call<HubRequest>("POST", `/requests/${encodeURIComponent(id)}/reply`, { body });
  }
  approve(id: string, note?: string) {
    return this.call<HubRequest>("POST", `/requests/${encodeURIComponent(id)}/approve`, { note });
  }
  reject(id: string, reason: string) {
    return this.call<HubRequest>("POST", `/requests/${encodeURIComponent(id)}/reject`, { reason });
  }
  close(id: string) {
    return this.call<HubRequest>("POST", `/requests/${encodeURIComponent(id)}/close`, {});
  }
  bootstrap(project: string) {
    return this.call<HubBootstrap>("GET", `/projects/${encodeURIComponent(project)}/bootstrap`);
  }
}
