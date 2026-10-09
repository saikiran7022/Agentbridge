import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { upsertUserFromLogin } from "@hub/core";

export const githubLoginEnabled = Boolean(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET);
export const devLoginEnabled = ["1", "true", "yes"].includes((process.env.HUB_DEV_LOGIN ?? "").toLowerCase());

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
