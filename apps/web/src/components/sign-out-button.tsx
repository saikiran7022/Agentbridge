"use client";

import { signOut } from "next-auth/react";

/** With single sign-on, also end the identity provider session so the next sign-in asks who you are. */
export function SignOutButton({ sso }: { sso?: boolean }) {
  return (
    <button
      onClick={() => (sso ? (window.location.href = "/api/oidc-logout") : signOut({ callbackUrl: "/login" }))}
      className="whitespace-nowrap text-xs text-slate-500 hover:text-slate-800"
    >
      Sign out
    </button>
  );
}
