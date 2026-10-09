import { createHmac, timingSafeEqual } from "node:crypto";
import { App, type Octokit } from "octokit";
import { githubConfigured, hubConfig } from "./env.js";

export interface RepoRef {
  owner: string;
  repo: string;
  installationId?: number | null;
}

export interface DiscussionCategory {
  id: string;
  name: string;
  slug: string;
}

export interface RepoInfo {
  repositoryId: string;
  installationId: number;
  discussionsEnabled: boolean;
  categories: DiscussionCategory[];
}

export interface CreatedDiscussion {
  id: string;
  number: number;
  url: string;
}

/** The subset of GitHub the Hub needs; swapped for a fake in tests. */
export interface DiscussionsClient {
  getRepoInfo(repo: RepoRef): Promise<RepoInfo>;
  createDiscussion(
    repo: RepoRef,
    input: { repositoryId: string; categoryId: string; title: string; body: string },
  ): Promise<CreatedDiscussion>;
  addComment(repo: RepoRef, input: { discussionId: string; body: string }): Promise<{ id: string; url: string }>;
  closeDiscussion(repo: RepoRef, input: { discussionId: string }): Promise<void>;
}

let app: App | null = null;

function getApp(): App {
  if (!app) {
    const cfg = hubConfig();
    app = new App({ appId: cfg.github.appId, privateKey: cfg.github.privateKey });
  }
  return app;
}

async function installationOctokit(repo: RepoRef): Promise<{ octokit: Octokit; installationId: number }> {
  let installationId = repo.installationId ?? null;
  if (!installationId) {
    const { data } = await getApp().octokit.request("GET /repos/{owner}/{repo}/installation", {
      owner: repo.owner,
      repo: repo.repo,
    });
    installationId = data.id;
  }
  return { octokit: await getApp().getInstallationOctokit(installationId), installationId };
}

export const githubAppClient: DiscussionsClient = {
  async getRepoInfo(repo) {
    const { octokit, installationId } = await installationOctokit(repo);
    const data = await octokit.graphql<{
      repository: {
        id: string;
        hasDiscussionsEnabled: boolean;
        discussionCategories: { nodes: DiscussionCategory[] };
      };
    }>(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          hasDiscussionsEnabled
          discussionCategories(first: 50) { nodes { id name slug } }
        }
      }`,
      { owner: repo.owner, name: repo.repo },
    );
    return {
      repositoryId: data.repository.id,
      installationId,
      discussionsEnabled: data.repository.hasDiscussionsEnabled,
      categories: data.repository.discussionCategories.nodes,
    };
  },

  async createDiscussion(repo, input) {
    const { octokit } = await installationOctokit(repo);
    const data = await octokit.graphql<{ createDiscussion: { discussion: CreatedDiscussion } }>(
      `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { id number url }
        }
      }`,
      input,
    );
    return data.createDiscussion.discussion;
  },

  async addComment(repo, input) {
    const { octokit } = await installationOctokit(repo);
    const data = await octokit.graphql<{ addDiscussionComment: { comment: { id: string; url: string } } }>(
      `mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) { comment { id url } }
      }`,
      input,
    );
    return data.addDiscussionComment.comment;
  },

  async closeDiscussion(repo, input) {
    const { octokit } = await installationOctokit(repo);
    await octokit.graphql(
      `mutation($discussionId: ID!) {
        closeDiscussion(input: { discussionId: $discussionId, reason: RESOLVED }) { discussion { id } }
      }`,
      input,
    );
  },
};

let override: DiscussionsClient | null | undefined;

/** Returns null when no GitHub App is configured; Discussions sync is then skipped. */
export function discussionsClient(): DiscussionsClient | null {
  if (override !== undefined) return override;
  return githubConfigured() ? githubAppClient : null;
}

export function setDiscussionsClient(client: DiscussionsClient | null | undefined): void {
  override = client;
}

export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Picks the Discussions category for a department: exact name, slug or key match, else the project fallback. */
export function matchCategory(
  categories: DiscussionCategory[],
  department: { key: string; name: string },
  fallback: string,
): { category: DiscussionCategory | null; usedFallback: boolean } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = [department.name, department.key].map(norm);
  const direct = categories.find((c) => wanted.includes(norm(c.name)) || wanted.includes(norm(c.slug)));
  if (direct) return { category: direct, usedFallback: false };
  const fb =
    categories.find((c) => norm(c.name) === norm(fallback)) ??
    categories.find((c) => norm(c.slug) === "general") ??
    categories[0] ??
    null;
  return { category: fb, usedFallback: true };
}
