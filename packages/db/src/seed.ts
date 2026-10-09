import { prisma } from "./index.js";

const DEFAULT_DEPARTMENTS = [
  { key: "dev", name: "Development", description: "Application developers" },
  { key: "devops", name: "DevOps", description: "CI/CD, release and platform tooling" },
  { key: "infra", name: "Infrastructure", description: "Cloud, networking, clusters and secrets" },
  { key: "security", name: "Security", description: "AppSec, IAM, compliance and reviews" },
];

async function main() {
  const slug = process.env.HUB_ORG_SLUG ?? "acme";
  const name = process.env.HUB_ORG_NAME ?? "Acme Engineering";
  const org = await prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { slug, name },
  });
  for (const d of DEFAULT_DEPARTMENTS) {
    await prisma.department.upsert({
      where: { orgId_key: { orgId: org.id, key: d.key } },
      update: {},
      create: { ...d, orgId: org.id },
    });
  }

  if (process.argv.includes("--demo")) {
    const depts = await prisma.department.findMany({ where: { orgId: org.id } });
    const byKey = Object.fromEntries(depts.map((d) => [d.key, d]));
    const people = [
      { login: "alice-dev", name: "Alice (Dev)", dept: "dev", role: "OWNER" as const, orgRole: "ADMIN" as const },
      { login: "omar-devops", name: "Omar (DevOps)", dept: "devops", role: "CONTRIBUTOR" as const, orgRole: "MEMBER" as const },
      { login: "ivan-infra", name: "Ivan (Infra)", dept: "infra", role: "APPROVER" as const, orgRole: "MEMBER" as const },
      { login: "sara-sec", name: "Sara (Security)", dept: "security", role: "APPROVER" as const, orgRole: "MEMBER" as const },
    ];
    const project = await prisma.project.upsert({
      where: { orgId_slug: { orgId: org.id, slug: "payments" } },
      update: {},
      create: { orgId: org.id, slug: "payments", name: "Payments Service", description: "Demo project" },
    });
    for (const p of people) {
      const user = await prisma.user.upsert({
        where: { login: p.login },
        update: {},
        create: { login: p.login, name: p.name },
      });
      await prisma.orgMember.upsert({
        where: { orgId_userId: { orgId: org.id, userId: user.id } },
        update: {},
        create: { orgId: org.id, userId: user.id, role: p.orgRole, departmentId: byKey[p.dept].id },
      });
      await prisma.teamMember.upsert({
        where: { departmentId_userId: { departmentId: byKey[p.dept].id, userId: user.id } },
        update: {},
        create: { departmentId: byKey[p.dept].id, userId: user.id },
      });
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: user.id } },
        update: {},
        create: { projectId: project.id, userId: user.id, departmentId: byKey[p.dept].id, role: p.role },
      });
      await prisma.liaisonAgent.upsert({
        where: { projectId_departmentId: { projectId: project.id, departmentId: byKey[p.dept].id } },
        update: {},
        create: { projectId: project.id, departmentId: byKey[p.dept].id },
      });
    }
    console.log(`Seeded demo project "payments" with ${people.length} members`);

    // Real tools for the demo agents. The kagent tool server runs with broad cluster permissions, so the
    // Hub only grants the explicit tool names below: reads for everyone, scale/rollout only to the
    // approval-gated "-exec" agents.
    const k8s = await prisma.mcpServer.upsert({
      where: { orgId_slug: { orgId: org.id, slug: "kubernetes" } },
      update: {},
      create: {
        orgId: org.id,
        slug: "kubernetes",
        name: "Kubernetes",
        description: "Inspect workloads, events, logs and Helm releases in the cluster. Scaling and restarts need an approved change.",
        transport: "STREAMABLE_HTTP",
        url: "http://kagent-tools.kagent:8084/mcp",
        access: "READ_WRITE",
        readTools: [
          "k8s_get_resources",
          "k8s_describe_resource",
          "k8s_get_resource_yaml",
          "k8s_get_events",
          "k8s_get_pod_logs",
          "k8s_get_available_api_resources",
          "k8s_get_cluster_configuration",
          "helm_list_releases",
          "helm_get_release",
          "datetime_get_current_time",
        ],
        writeTools: ["k8s_scale", "k8s_rollout"],
      },
    });
    const docs = await prisma.mcpServer.upsert({
      where: { orgId_slug: { orgId: org.id, slug: "context7" } },
      update: {},
      create: {
        orgId: org.id,
        slug: "context7",
        name: "Library docs (Context7)",
        description: "Up-to-date documentation for libraries and frameworks.",
        transport: "STREAMABLE_HTTP",
        url: "https://mcp.context7.com/mcp",
        access: "READ_ONLY",
        readTools: ["resolve-library-id", "query-docs"],
        writeTools: [],
      },
    });
    const attach: [string, string, "READ_ONLY" | "APPROVAL_FOR_WRITES" | null][] = [
      ["devops", k8s.id, "APPROVAL_FOR_WRITES"],
      ["infra", k8s.id, "APPROVAL_FOR_WRITES"],
      ["dev", docs.id, null],
    ];
    for (const [dept, mcpServerId, autonomy] of attach) {
      const agent = await prisma.liaisonAgent.findUniqueOrThrow({
        where: { projectId_departmentId: { projectId: project.id, departmentId: byKey[dept].id } },
      });
      if (autonomy) await prisma.liaisonAgent.update({ where: { id: agent.id }, data: { autonomy, syncStatus: "PENDING" } });
      await prisma.liaisonAgentMcp.upsert({
        where: { agentId_mcpServerId: { agentId: agent.id, mcpServerId } },
        update: {},
        create: { agentId: agent.id, mcpServerId },
      });
      if (!autonomy) await prisma.liaisonAgent.update({ where: { id: agent.id }, data: { syncStatus: "PENDING" } });
    }
    console.log("Attached demo MCP servers: kubernetes (devops, infra), context7 (dev)");
  }

  console.log(`Organization "${org.name}" (${org.slug}) ready`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
