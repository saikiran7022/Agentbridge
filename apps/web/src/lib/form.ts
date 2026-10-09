import { redirect } from "next/navigation";
import { HubError } from "@hub/core";

export function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(fd: FormData, name: string): string | null {
  return str(fd, name) || null;
}

export function list(fd: FormData, name: string): string[] {
  return str(fd, name)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function bool(fd: FormData, name: string): boolean {
  return fd.get(name) === "on" || fd.get(name) === "true";
}

export function num(fd: FormData, name: string, fallback: number): number {
  const n = Number(str(fd, name));
  return Number.isFinite(n) && str(fd, name) !== "" ? n : fallback;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function withMessage(path: string, kind: "ok" | "error", message: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${kind}=${encodeURIComponent(message)}`;
}

function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

/** Runs a server action body and redirects back with a success or error banner. */
export async function act(path: string, fn: () => Promise<string | void>): Promise<never> {
  let message: string | void;
  try {
    message = await fn();
  } catch (err) {
    if (isRedirect(err)) throw err;
    const text =
      err instanceof HubError
        ? err.message
        : (err as { code?: string }).code === "P2002"
          ? "That name or key is already taken"
          : err instanceof Error
            ? err.message
            : String(err);
    redirect(withMessage(path, "error", text));
  }
  redirect(message ? withMessage(path, "ok", message) : path);
}
