import { api } from "@/lib/api";
import { directHubApi } from "@/lib/hub-api";

export const GET = api<{ slug: string }>(async (_req, user, { slug }) => directHubApi(user).bootstrap(slug));
