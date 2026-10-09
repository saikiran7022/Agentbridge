import { api } from "@/lib/api";
import { directHubApi } from "@/lib/hub-api";

export const GET = api(async (_req, user) => directHubApi(user).me());
