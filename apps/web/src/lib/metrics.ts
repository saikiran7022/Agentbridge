import { prisma, type Prisma } from "@hub/db";

export interface RequestMetrics {
  total: number;
  last7Days: number;
  open: number;
  waitingOnPeople: number;
  answered: number;
  answeredByAgent: number;
  agentShare: number | null;
  medianMinutesToAnswer: number | null;
  byTeam: { team: string; total: number; byAgent: number; waiting: number }[];
}

export async function requestMetrics(where: Prisma.RequestWhereInput): Promise<RequestMetrics> {
  const since30 = new Date(Date.now() - 30 * 86400_000);
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const rows = await prisma.request.findMany({
    where: { ...where, createdAt: { gte: since30 } },
    select: {
      status: true,
      answeredByAgent: true,
      createdAt: true,
      answeredAt: true,
      resolvedDepartment: { select: { name: true } },
      targetDepartment: { select: { name: true } },
    },
  });
  const answered = rows.filter((r) => r.answeredAt);
  const durations = answered.map((r) => (r.answeredAt!.getTime() - r.createdAt.getTime()) / 60000).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const byAgent = answered.filter((r) => r.answeredByAgent).length;
  const teams = new Map<string, { team: string; total: number; byAgent: number; waiting: number }>();
  for (const r of rows) {
    const team = r.resolvedDepartment?.name ?? r.targetDepartment?.name ?? "Unrouted";
    const t = teams.get(team) ?? { team, total: 0, byAgent: 0, waiting: 0 };
    t.total += 1;
    if (r.answeredByAgent) t.byAgent += 1;
    if (r.status === "ESCALATED" || r.status === "AWAITING_APPROVAL") t.waiting += 1;
    teams.set(team, t);
  }
  return {
    total: rows.length,
    last7Days: rows.filter((r) => r.createdAt >= since7).length,
    open: rows.filter((r) => ["OPEN", "ROUTING", "IN_PROGRESS", "APPROVED"].includes(r.status)).length,
    waitingOnPeople: rows.filter((r) => r.status === "ESCALATED" || r.status === "AWAITING_APPROVAL").length,
    answered: answered.length,
    answeredByAgent: byAgent,
    agentShare: answered.length ? byAgent / answered.length : null,
    medianMinutesToAnswer: median,
    byTeam: [...teams.values()].sort((a, b) => b.total - a.total),
  };
}

export function formatMinutes(m: number | null): string {
  if (m === null) return "n/a";
  if (m < 1) return `${Math.round(m * 60)}s`;
  if (m < 120) return `${Math.round(m)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

export function formatPercent(p: number | null): string {
  return p === null ? "n/a" : `${Math.round(p * 100)}%`;
}

export interface DailyCount {
  day: string;
  label: string;
  total: number;
  byAgent: number;
}

/** Requests created per day for the last `days` days (oldest first), with how many an agent answered. */
export async function dailyRequestCounts(where: Prisma.RequestWhereInput, days = 14): Promise<DailyCount[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const rows = await prisma.request.findMany({
    where: { ...where, createdAt: { gte: start } },
    select: { createdAt: true, answeredByAgent: true, status: true },
  });
  const out: DailyCount[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push({ day: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en", { month: "short", day: "numeric" }), total: 0, byAgent: 0 });
  }
  const byDay = new Map(out.map((o) => [o.day, o]));
  for (const r of rows) {
    const d = new Date(r.createdAt);
    d.setHours(0, 0, 0, 0);
    const slot = byDay.get(d.toISOString().slice(0, 10)) ?? byDay.get(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
    if (!slot) continue;
    slot.total += 1;
    if (r.answeredByAgent && r.status === "ANSWERED") slot.byAgent += 1;
  }
  return out;
}
