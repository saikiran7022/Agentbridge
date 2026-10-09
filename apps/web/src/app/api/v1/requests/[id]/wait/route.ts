import { api } from "@/lib/api";
import { directHubApi } from "@/lib/hub-api";

export const maxDuration = 130;

export const GET = api<{ id: string }>(async (req, user, { id }) => {
  const timeout = Number(req.nextUrl.searchParams.get("timeout") ?? "60");
  return directHubApi(user).waitFor(id, Number.isFinite(timeout) ? timeout : 60);
});
