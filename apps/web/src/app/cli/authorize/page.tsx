import { redirect } from "next/navigation";
import { createApiToken } from "@hub/core";
import { getCurrentUser } from "@/lib/session";
import { Button } from "@/components/ui";

function loopbackCallback(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return url.protocol === "http:" && loopback ? url : null;
  } catch {
    return null;
  }
}

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ callback?: string; state?: string; name?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const here = `/cli/authorize?${new URLSearchParams(sp as Record<string, string>).toString()}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(here)}`);
  }
  const callback = loopbackCallback(sp.callback);
  const clientName = (sp.name ?? "hub CLI").slice(0, 60);

  async function authorize() {
    "use server";
    const current = await getCurrentUser();
    const cb = loopbackCallback(sp.callback);
    if (!current || !cb) redirect("/get-started");
    const { token } = await createApiToken(current.id, `CLI: ${clientName}`);
    cb.searchParams.set("token", token);
    cb.searchParams.set("state", sp.state ?? "");
    cb.searchParams.set("login", current.login);
    redirect(cb.toString());
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <h1 className="text-lg font-semibold">Authorize the hub CLI</h1>
        {callback ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              <strong>{clientName}</strong> wants an API token for <strong>{user.login}</strong>. It will be able to ask and answer requests as you.
            </p>
            <form action={authorize} className="mt-6 flex gap-2">
              <Button type="submit">Authorize</Button>
              <a href="/" className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800">Cancel</a>
            </form>
          </>
        ) : (
          <p className="mt-2 text-sm text-rose-700">Invalid callback address. Run `hub login` again.</p>
        )}
      </div>
    </div>
  );
}
