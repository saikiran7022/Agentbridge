import * as k8s from "@kubernetes/client-node";
import { prisma } from "@hub/db";
import { LABEL_PROJECT, MANAGED_BY, MANAGED_KINDS, type K8sManifest } from "@hub/agent-templates";
import { audit, hubConfig, renderProjectManifests } from "@hub/core";

let client: k8s.KubernetesObjectApi | null = null;

function kubeClient(): k8s.KubernetesObjectApi {
  if (!client) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    client = k8s.KubernetesObjectApi.makeApiClient(kc);
  }
  return client;
}

function errorMessage(err: unknown): string {
  const e = err as { code?: number; body?: unknown; message?: string };
  const body = typeof e.body === "string" ? e.body : e.body ? JSON.stringify(e.body) : "";
  return [e.code ? `HTTP ${e.code}` : "", e.message ?? "", body].filter(Boolean).join(" ").slice(0, 1000);
}

async function applyAll(manifests: K8sManifest[]): Promise<void> {
  const api = kubeClient();
  for (const m of manifests) {
    try {
      await api.patch(m as k8s.KubernetesObject, undefined, undefined, MANAGED_BY, true, k8s.PatchStrategy.ServerSideApply);
    } catch (err) {
      const msg = errorMessage(err);
      if (/404/.test(msg) && /the server could not find the requested resource|not found/i.test(msg)) {
        throw new Error(`${m.kind} ${m.metadata.name}: kagent CRDs for ${m.apiVersion} are not installed in the cluster (${msg})`);
      }
      throw new Error(`${m.kind} ${m.metadata.name}: ${msg}`);
    }
  }
}

/** Deletes Hub-managed kagent objects for the project that are no longer rendered. */
async function prune(projectSlug: string, desired: K8sManifest[], namespace: string): Promise<string[]> {
  const api = kubeClient();
  const keep = new Set(desired.map((m) => `${m.kind}/${m.metadata.name}`));
  const removed: string[] = [];
  for (const kind of MANAGED_KINDS) {
    let items: k8s.KubernetesObject[] = [];
    try {
      const list = await api.list(kind.apiVersion, kind.kind, namespace, undefined, undefined, undefined, undefined,
        `app.kubernetes.io/managed-by=${MANAGED_BY},${LABEL_PROJECT}=${projectSlug}`);
      items = list.items;
    } catch {
      continue;
    }
    for (const item of items) {
      const key = `${kind.kind}/${item.metadata?.name}`;
      if (keep.has(key)) continue;
      await api.delete({ apiVersion: kind.apiVersion, kind: kind.kind, metadata: { name: item.metadata!.name!, namespace } });
      removed.push(key);
    }
  }
  return removed;
}

export async function reconcileProject(projectId: string): Promise<{ applied: number; removed: string[]; mode: string }> {
  const cfg = hubConfig();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { agents: true } });
  const { manifests } = await renderProjectManifests(projectId);
  const now = new Date();

  const markAll = async (status: "SYNCED" | "RENDERED" | "ERROR", error: string | null) => {
    for (const a of project.agents) {
      const effective = !a.enabled || project.archived ? "DISABLED" : status;
      await prisma.liaisonAgent.update({
        where: { id: a.id },
        data: { syncStatus: effective, syncError: effective === "ERROR" ? error : null, lastSyncedAt: now },
      });
    }
  };

  if (!cfg.kagent.kubeApply) {
    await markAll("RENDERED", null);
    return { applied: 0, removed: [], mode: "rendered" };
  }

  try {
    await applyAll(manifests);
    const removed = await prune(project.slug, manifests, cfg.kagent.namespace);
    await markAll("SYNCED", null);
    await audit({ orgId: project.orgId, projectId, actor: { type: "SYSTEM" }, action: "agents.synced", data: { applied: manifests.length, removed } });
    return { applied: manifests.length, removed, mode: "applied" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markAll("ERROR", msg);
    await audit({ orgId: project.orgId, projectId, actor: { type: "SYSTEM" }, action: "agents.sync_failed", data: { error: msg } });
    throw err;
  }
}
