import { requireProject } from "@/lib/session";
import { Badge } from "@/components/ui";
import { ProjectTabs } from "./project-tabs";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { project, membership, canManage } = await requireProject(slug);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        {project.archived && <Badge>archived</Badge>}
        {membership && <Badge tone="violet">{membership.role.toLowerCase()}</Badge>}
        {project.githubOwner && (
          <a
            href={`https://github.com/${project.githubOwner}/${project.githubRepo}/discussions`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-500 hover:text-indigo-600"
          >
            {project.githubOwner}/{project.githubRepo} discussions
          </a>
        )}
      </div>
      <ProjectTabs slug={slug} canManage={canManage} />
      {children}
    </>
  );
}
