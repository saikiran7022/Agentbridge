import { listRequests, notFound, serializeRequest } from "@hub/core";
import { api, jsonBody } from "@/lib/api";
import { directHubApi, projectsFor } from "@/lib/hub-api";

export const GET = api<{ slug: string }>(async (_req, user, { slug }) => {
  const projects = await projectsFor(user);
  if (!projects.some((p) => p.slug === slug)) throw notFound(`Project "${slug}"`);
  const rows = await listRequests({ project: { slug } }, 50);
  return rows.map(serializeRequest);
});

export const POST = api<{ slug: string }>(async (req, user, { slug }) => {
  const body = await jsonBody<{ team?: string; question?: string; context?: string; title?: string; client?: string }>(req);
  return directHubApi(user).ask({
    project: slug,
    team: body.team,
    question: body.question ?? "",
    context: body.context,
    title: body.title,
    client: body.client ?? req.headers.get("user-agent")?.slice(0, 60) ?? "api",
  });
});
