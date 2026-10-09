"use server";

import { cancelJoinRequest, requestToJoin } from "@hub/core";
import { act, str } from "@/lib/form";
import { getOrgContext } from "@/lib/session";

export async function requestJoin(fd: FormData) {
  return act("/teams", async () => {
    const { org, user } = await getOrgContext();
    await requestToJoin({ orgId: org.id, userId: user.id, departmentId: str(fd, "departmentId"), message: str(fd, "message") });
    return "Request sent. An org admin will review it.";
  });
}

export async function cancelJoin(fd: FormData) {
  return act("/teams", async () => {
    const { user } = await getOrgContext();
    await cancelJoinRequest({ userId: user.id, requestId: str(fd, "requestId") });
    return "Request cancelled";
  });
}
