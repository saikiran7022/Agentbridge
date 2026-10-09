"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button, Input } from "@/components/ui";

export function LoginButtons({ github, dev, sso, callbackUrl }: { github: boolean; dev: boolean; sso: string | null; callbackUrl: string }) {
  const [login, setLogin] = useState("");
  return (
    <div className="space-y-4">
      {sso && (
        <div className="space-y-2">
          <Button className="w-full" onClick={() => signIn("oidc", { callbackUrl })}>
            Sign in with {sso}
          </Button>
          <p className="text-center text-xs text-slate-500">
            New here? Choose <strong>Register</strong> on the next page. Your account is created right away, then you can ask to join teams.
          </p>
        </div>
      )}
      {github && (
        <Button className="w-full" onClick={() => signIn("github", { callbackUrl })}>
          Sign in with GitHub
        </Button>
      )}
      {dev && (
        <form
          className="space-y-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            signIn("dev", { login, callbackUrl });
          }}
        >
          <p className="text-xs font-medium text-amber-800">Development login (HUB_DEV_LOGIN=true)</p>
          <Input placeholder="GitHub login, e.g. alice-dev" value={login} onChange={(e) => setLogin(e.target.value)} />
          <Button type="submit" variant="secondary" className="w-full" disabled={!login}>
            Continue as {login || "..."}
          </Button>
        </form>
      )}
    </div>
  );
}
