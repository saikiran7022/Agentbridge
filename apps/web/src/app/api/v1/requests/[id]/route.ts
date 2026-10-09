import { api } from "@/lib/api";
import { directHubApi } from "@/lib/hub-api";

export const GET = api<{ id: string }>(async (_req, user, { id }) => directHubApi(user).getRequest(id));
