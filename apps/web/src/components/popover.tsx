import type { ReactNode } from "react";
import { cx } from "./ui";

/** A button that opens a small form panel, with no client JavaScript. `inline` expands in place (use inside scroll containers). */
export function Popover({ label, align = "left", inline, children, className }: { label: ReactNode; align?: "left" | "right"; inline?: boolean; children: ReactNode; className?: string }) {
  return (
    <details className={cx("group relative", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 group-open:border-indigo-400 group-open:text-indigo-700 [&::-webkit-details-marker]:hidden">
        {label}
      </summary>
      <div
        className={cx(
          "mt-2 rounded-xl border border-slate-200 bg-white p-4",
          inline ? "w-full bg-slate-50" : cx("absolute z-20 w-72 shadow-xl", align === "right" ? "right-0" : "left-0"),
        )}
      >
        {children}
      </div>
    </details>
  );
}
