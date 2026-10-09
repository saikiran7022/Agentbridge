import { NextResponse, type NextRequest } from "next/server";
import { HubError, verifyApiToken } from "@hub/core";
import type { User } from "@hub/db";
import { getCurrentUser } from "./session";

/** Authenticates API calls from hub-mcp / the CLI (bearer token) or from the browser (session cookie). */
export async function apiUser(req: NextRequest): Promise<User> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (token) {
    const user = await verifyApiToken(token);
    if (!user) throw new HubError(401, "Invalid or revoked API token");
    return user;
  }
  const user = await getCurrentUser();
  if (!user) throw new HubError(401, "Authentication required: pass `Authorization: Bearer <hub token>`");
  return user;
}

type Ctx<P> = { params: Promise<P> };

export function api<P = Record<string, string>>(
  handler: (req: NextRequest, user: User, params: P) => Promise<unknown>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const user = await apiUser(req);
      const result = await handler(req, user, await ctx.params);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      if (err instanceof HubError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function jsonBody<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HubError(400, "Request body must be JSON");
  }
}
