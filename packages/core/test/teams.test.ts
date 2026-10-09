import { beforeEach, describe, expect, inject, it } from "vitest";
import { prisma, type Department, type User } from "@hub/db";
import { ensureDefaultOrg, upsertUserFromOidc } from "../src/projects";
import {
  addTeamMember,
  authorizeProjectSeat,
  cancelJoinRequest,
  decideJoinRequest,
  isTeamMember,
  removeTeamMember,
  requestToJoin,
} from "../src/teams";

const dbReady = inject("dbReady");

describe.skipIf(!dbReady)("teams, join requests and RBAC", () => {
  let orgId: string;
  let admin: User;
  let dana: User;
  let eve: User;
  let infra: Department;
  let sec: Department;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AuditEvent","TeamJoinRequest","TeamMember","ProjectMember","LiaisonAgent","Project","OrgMember","Department","User","Organization" CASCADE',
    );
    const org = await ensureDefaultOrg();
    orgId = org.id;
    const mk = async (login: string, role: "ADMIN" | "MEMBER") => {
      const u = await prisma.user.create({ data: { login } });
      await prisma.orgMember.create({ data: { orgId, userId: u.id, role } });
      return u;
    };
    admin = await mk("root", "ADMIN");
    dana = await mk("dana", "MEMBER");
    eve = await mk("eve", "MEMBER");
    infra = await prisma.department.findFirstOrThrow({ where: { orgId, key: "infra" } });
    sec = await prisma.department.findFirstOrThrow({ where: { orgId, key: "security" } });
  });

  it("lets a person ask for several teams and only an admin decide", async () => {
    const r1 = await requestToJoin({ orgId, userId: dana.id, departmentId: infra.id, message: "I run the clusters" });
    const r2 = await requestToJoin({ orgId, userId: dana.id, departmentId: sec.id });
    await expect(requestToJoin({ orgId, userId: dana.id, departmentId: infra.id })).rejects.toThrow(/already asked/);

    await expect(decideJoinRequest({ orgId, requestId: r1.id, actorId: eve.id, approve: true })).rejects.toThrow(/Only organization admins/);
    expect(await isTeamMember(dana.id, infra.id)).toBe(false);

    await decideJoinRequest({ orgId, requestId: r1.id, actorId: admin.id, approve: true, note: "welcome" });
    await decideJoinRequest({ orgId, requestId: r2.id, actorId: admin.id, approve: false, note: "not now" });
    expect(await isTeamMember(dana.id, infra.id)).toBe(true);
    expect(await isTeamMember(dana.id, sec.id)).toBe(false);
    const home = await prisma.orgMember.findFirstOrThrow({ where: { userId: dana.id } });
    expect(home.departmentId).toBe(infra.id);
    expect((await prisma.teamJoinRequest.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("REJECTED");
    await expect(decideJoinRequest({ orgId, requestId: r1.id, actorId: admin.id, approve: true })).rejects.toThrow(/already decided/);
  });

  it("lets people cancel their own pending request but not someone else's", async () => {
    const r = await requestToJoin({ orgId, userId: dana.id, departmentId: sec.id });
    await expect(cancelJoinRequest({ userId: eve.id, requestId: r.id })).rejects.toThrow(/not found/);
    await cancelJoinRequest({ userId: dana.id, requestId: r.id });
    expect((await prisma.teamJoinRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
    await requestToJoin({ orgId, userId: dana.id, departmentId: sec.id });
  });

  it("only seats people on projects for teams they belong to, unless an admin does it", async () => {
    await expect(authorizeProjectSeat({ orgId, actorId: eve.id, userId: dana.id, departmentId: infra.id })).rejects.toThrow(/request to join/);
    await addTeamMember({ orgId, departmentId: infra.id, userId: dana.id, actorId: admin.id });
    await authorizeProjectSeat({ orgId, actorId: eve.id, userId: dana.id, departmentId: infra.id });
    await authorizeProjectSeat({ orgId, actorId: admin.id, userId: eve.id, departmentId: sec.id });
    expect(await isTeamMember(eve.id, sec.id)).toBe(true);
    await expect(addTeamMember({ orgId, departmentId: sec.id, userId: dana.id, actorId: eve.id })).rejects.toThrow(/Only organization admins/);
  });

  it("refuses to remove someone who still holds project seats", async () => {
    await addTeamMember({ orgId, departmentId: infra.id, userId: dana.id, actorId: admin.id });
    const project = await prisma.project.create({ data: { orgId, slug: "p", name: "P" } });
    await prisma.projectMember.create({ data: { projectId: project.id, userId: dana.id, departmentId: infra.id, role: "APPROVER" } });
    await expect(removeTeamMember({ orgId, departmentId: infra.id, userId: dana.id, actorId: admin.id })).rejects.toThrow(/seats/);
    await prisma.projectMember.deleteMany({});
    await removeTeamMember({ orgId, departmentId: infra.id, userId: dana.id, actorId: admin.id });
    expect(await isTeamMember(dana.id, infra.id)).toBe(false);
  });

  it("signs people in from OIDC without letting a newcomer take over an existing account", async () => {
    const first = await upsertUserFromOidc({ sub: "kc-1", login: "Newbie", name: "New Bie", email: "n@x.io" });
    expect(first.login).toBe("newbie");
    const again = await upsertUserFromOidc({ sub: "kc-1", login: "renamed" });
    expect(again.id).toBe(first.id);
    expect((await prisma.orgMember.findFirstOrThrow({ where: { userId: first.id } })).role).toBe("MEMBER");

    // "dana" was pre-provisioned by an admin and never signed in: the first OIDC login claims it.
    const claimed = await upsertUserFromOidc({ sub: "kc-2", login: "dana" });
    expect(claimed.id).toBe(dana.id);
    // A second identity asking for the same login gets a different account.
    const other = await upsertUserFromOidc({ sub: "kc-3", login: "dana" });
    expect(other.id).not.toBe(dana.id);
    expect(other.login).toBe("dana-2");

    const boss = await upsertUserFromOidc({ sub: "kc-4", login: "boss", roles: ["hub-admin"] });
    expect((await prisma.orgMember.findFirstOrThrow({ where: { userId: boss.id } })).role).toBe("ADMIN");
  });
});
