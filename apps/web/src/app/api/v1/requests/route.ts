import { api } from "@/lib/api";
import { directHubApi } from "@/lib/hub-api";

export const GET = api(async (req, user) => directHubApi(user).myRequests(req.nextUrl.searchParams.get("status") ?? undefined));
