import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { upsertUserFromLogin, upsertUserFromOidc } from "@hub/core";

export const githubLoginEnabled = Boolean(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET);
export const devLoginEnabled = ["1", "true", "yes"].includes((process.env.HUB_DEV_LOGIN ?? "").toLowerCase());

export const oidc = {
  enabled: Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID),
  name: process.env.OIDC_NAME ?? "SSO",
  issuer: process.env.OIDC_ISSUER ?? "",
  /** Discovery and token calls can use an in-cluster address while browsers use the public issuer. */
  internalUrl: process.env.OIDC_INTERNAL_URL || process.env.OIDC_ISSUER || "",
  clientId: process.env.OIDC_CLIENT_ID ?? "",
  adminRole: process.env.OIDC_ADMIN_ROLE ?? "hub-admin",
};

interface OidcClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  picture?: string;
  roles?: string[];
}

interface GithubProfile {
  id: number | string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    ...(githubLoginEnabled
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_APP_CLIENT_ID!,
            clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
          }),
        ]
      : []),
    ...(oidc.enabled
      ? [
          {
            id: "oidc",
            name: oidc.name,
            type: "oauth" as const,
            wellKnown: `${oidc.internalUrl}/.well-known/openid-configuration`,
            issuer: oidc.issuer,
            clientId: oidc.clientId,
            clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
            authorization: { params: { scope: "openid profile email" } },
            idToken: true,
            checks: ["pkce", "state"] as ("pkce" | "state")[],
            profile(p: OidcClaims) {
              return { id: p.sub, name: p.name ?? p.preferred_username ?? p.sub, email: p.email, image: p.picture };
            },
          },
        ]
      : []),
    ...(devLoginEnabled
      ? [
          CredentialsProvider({
            id: "dev",
            name: "Development login",
            credentials: { login: { label: "GitHub login", type: "text" } },
            async authorize(credentials) {
              const login = credentials?.login?.trim().toLowerCase();
              if (!login || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(login)) return null;
              const user = await upsertUserFromLogin({ login });
              return { id: user.id, name: user.name ?? user.login };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "github" && profile) {
        const p = profile as unknown as GithubProfile;
        const hubUser = await upsertUserFromLogin({
          login: p.login.toLowerCase(),
          githubId: String(p.id),
          name: p.name,
          email: p.email,
          avatarUrl: p.avatar_url,
        });
        token.hubUserId = hubUser.id;
      } else if (account?.provider === "oidc" && profile) {
        const p = profile as unknown as OidcClaims;
        const hubUser = await upsertUserFromOidc({
          sub: p.sub,
          login: p.preferred_username ?? p.email?.split("@")[0] ?? p.sub,
          name: p.name,
          email: p.email,
          avatarUrl: p.picture,
          roles: (p.roles ?? []).includes(oidc.adminRole) ? ["hub-admin"] : [],
        });
        token.hubUserId = hubUser.id;
        token.idToken = account.id_token;
      } else if (account?.provider === "dev" && user) {
        token.hubUserId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      (session as { hubUserId?: string }).hubUserId = token.hubUserId as string | undefined;
      return session;
    },
  },
};
