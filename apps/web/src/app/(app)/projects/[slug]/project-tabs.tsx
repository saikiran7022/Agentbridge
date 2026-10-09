"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export function ProjectTabs({ slug, canManage }: { slug: string; canManage: boolean }) {
  const path = usePathname();
  const base = `/projects/${slug}`;
  const tabs = [
    { href: base, label: "Overview", active: path === base || path.startsWith(`${base}/requests`) },
    { href: `${base}/members`, label: "People" },
    { href: `${base}/agents`, label: "Agents" },
    ...(canManage ? [{ href: `${base}/settings`, label: "GitHub & settings" }] : []),
    { href: `${base}/audit`, label: "Audit log" },
  ];
  return (
    <nav className="mb-6 flex gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.active ?? path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
