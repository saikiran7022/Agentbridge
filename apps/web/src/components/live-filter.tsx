"use client";

import { useRef } from "react";

/** Filters every element carrying `data-filter-item` inside `target` (a CSS selector) as you type. */
export function LiveFilter({ target, placeholder }: { target: string; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      type="search"
      placeholder={placeholder}
      onChange={(e) => {
        const q = e.target.value.trim().toLowerCase();
        document.querySelectorAll<HTMLElement>(`${target} [data-filter-item]`).forEach((el) => {
          el.hidden = q !== "" && !(el.dataset.filterItem ?? "").includes(q);
        });
      }}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:w-64"
    />
  );
}
