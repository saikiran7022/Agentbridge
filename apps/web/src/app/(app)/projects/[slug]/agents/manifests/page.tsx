import { renderProjectManifests } from "@hub/core";
import { Card, LinkButton, Pre } from "@/components/ui";
import { requireProject } from "@/lib/session";

export default async function ManifestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { project } = await requireProject(slug);
  let yaml: string;
  let count = 0;
  try {
    const rendered = await renderProjectManifests(project.id);
    yaml = rendered.yaml;
    count = rendered.manifests.length;
  } catch (err) {
    yaml = `# Could not render manifests: ${err instanceof Error ? err.message : String(err)}`;
  }
  return (
    <Card
      title={`${count} kagent resources`}
      actions={
        <div className="flex gap-2">
          <LinkButton href={`/api/projects/${slug}/manifests`} size="sm">Download YAML</LinkButton>
          <LinkButton href={`/projects/${slug}/agents`} size="sm">Back</LinkButton>
        </div>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        These are applied automatically when <code>HUB_KUBE_APPLY=true</code>. Otherwise apply them yourself with{" "}
        <code>kubectl apply -f {slug}-agents.yaml</code>.
      </p>
      <Pre>{yaml}</Pre>
    </Card>
  );
}
