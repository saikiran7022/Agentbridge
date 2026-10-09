"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function NavLink({ href, exact, badge, children }: { href: string; exact?: boolean; badge?: number; children: React.ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cx(
        "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
        active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100",
      )}
    >
      {children}
      {badge ? <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{badge}</span> : null}
    </Link>
  );
}
