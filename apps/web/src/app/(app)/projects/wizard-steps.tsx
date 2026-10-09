import Link from "next/link";
import { cx } from "@/components/ui";

const STEPS = [
  { n: 1, label: "Basics", path: "" },
  { n: 2, label: "People", path: "/members" },
  { n: 3, label: "Agents", path: "/agents" },
  { n: 4, label: "GitHub", path: "/settings" },
  { n: 5, label: "Onboard", path: "/get-started" },
];

export function WizardSteps({ current, slug }: { current: number; slug?: string }) {
  return (
    <ol className="mb-6 grid grid-cols-5 gap-2 text-xs">
      {STEPS.map((s) => {
        const href = slug ? (s.n === 5 ? `/get-started?project=${slug}` : `/projects/${slug}${s.path}`) : undefined;
        const body = (
          <div
            className={cx(
              "rounded-lg border px-3 py-2",
              s.n === current ? "border-indigo-500 bg-indigo-50 text-indigo-700" : s.n < current ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500",
            )}
          >
            <span className="font-semibold">{s.n}.</span> {s.label}
          </div>
        );
        return <li key={s.n}>{href && s.n !== current ? <Link href={href}>{body}</Link> : body}</li>;
      })}
    </ol>
  );
}
