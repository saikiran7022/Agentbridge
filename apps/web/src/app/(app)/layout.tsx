import Link from "next/link";
import { listInbox } from "@hub/core";
import { getOrgContext } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLink } from "@/components/nav-link";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, org, isAdmin } = await getOrgContext();
  const inbox = await listInbox(user);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <Link href="/" className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">AL</span>
          <span>
            <span className="block text-sm font-semibold leading-tight">Agent Liaison Hub</span>
            <span className="block text-xs text-slate-500">{org.name}</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-0.5 px-3">
          <NavLink href="/" exact>Dashboard</NavLink>
          <NavLink href="/inbox" badge={inbox.length || undefined}>My inbox</NavLink>
          <NavLink href="/projects">Projects</NavLink>
          <NavLink href="/get-started">Get started</NavLink>
          {isAdmin && (
            <>
              <div className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Organization</div>
              <NavLink href="/admin/users">People</NavLink>
              <NavLink href="/admin/departments">Departments</NavLink>
              <NavLink href="/admin/mcp-servers">MCP servers</NavLink>
              <NavLink href="/admin/skills">Skills</NavLink>
            </>
          )}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">
                {user.login.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="truncate text-sm">{user.login}</span>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
