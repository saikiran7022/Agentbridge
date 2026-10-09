"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-xs text-slate-500 hover:text-slate-800">
      Sign out
    </button>
  );
}
