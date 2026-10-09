import { redirect } from "next/navigation";
import { devLoginEnabled, githubLoginEnabled } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";
import { LoginButtons } from "./login-buttons";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await getCurrentUser()) redirect(sp.callbackUrl ?? "/");
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">AL</span>
          <div>
            <h1 className="text-lg font-semibold">Agent Liaison Hub</h1>
            <p className="text-sm text-slate-500">Let your agents ask other teams' agents first.</p>
          </div>
        </div>
        {sp.error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Sign-in failed ({sp.error}).</p>}
        <LoginButtons github={githubLoginEnabled} dev={devLoginEnabled} callbackUrl={sp.callbackUrl ?? "/"} />
        {!githubLoginEnabled && !devLoginEnabled && (
          <p className="text-sm text-slate-600">
            No sign-in method is configured. Set <code>GITHUB_APP_CLIENT_ID</code> and <code>GITHUB_APP_CLIENT_SECRET</code>, or{" "}
            <code>HUB_DEV_LOGIN=true</code> for local development.
          </p>
        )}
      </div>
    </div>
  );
}
