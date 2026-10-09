import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { oidc } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Clears the Hub session, then ends the identity provider session and returns to the login page. */
export async function GET(req: NextRequest) {
  const hub = (process.env.HUB_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const token = await getToken({ req });
  let target = `${hub}/login`;
  if (oidc.enabled) {
    const url = new URL(`${oidc.issuer}/protocol/openid-connect/logout`);
    url.searchParams.set("post_logout_redirect_uri", `${hub}/login`);
    url.searchParams.set("client_id", oidc.clientId);
    if (typeof token?.idToken === "string") url.searchParams.set("id_token_hint", token.idToken);
    target = url.toString();
  }
  const res = NextResponse.redirect(target);
  for (const name of ["next-auth.session-token", "__Secure-next-auth.session-token", "next-auth.callback-url", "__Secure-next-auth.callback-url"]) {
    res.cookies.set(name, "", { maxAge: 0, path: "/" });
  }
  return res;
}
