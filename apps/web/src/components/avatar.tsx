import { cx } from "./ui";

const TONES = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-cyan-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-fuchsia-500 to-purple-500",
] as const;

/** Distinct colour per position, so neighbouring teams never look alike. */
export function toneAt(index: number): string {
  return TONES[index % TONES.length];
}

export function toneFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

const sizes = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-12 w-12 text-base" };

export function Avatar({ name, src, size = "sm", square, className }: { name: string; src?: string | null; size?: keyof typeof sizes; square?: boolean; className?: string }) {
  const shape = square ? "rounded-xl" : "rounded-full";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" title={name} className={cx("shrink-0 object-cover ring-2 ring-white", sizes[size], shape, className)} />;
  }
  return (
    <span
      title={name}
      className={cx("flex shrink-0 items-center justify-center bg-gradient-to-br font-semibold text-white ring-2 ring-white", toneFor(name), sizes[size], shape, className)}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function AvatarStack({ people, max = 4 }: { people: { name: string; src?: string | null }[]; max?: number }) {
  if (!people.length) return <span className="text-xs text-slate-400">No one yet</span>;
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <Avatar key={p.name} name={p.name} src={p.src} size="xs" />
        ))}
      </div>
      {people.length > max && <span className="ml-2 text-xs text-slate-500">+{people.length - max}</span>}
    </div>
  );
}
