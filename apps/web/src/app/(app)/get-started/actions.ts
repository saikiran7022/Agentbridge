"use server";

import { revalidatePath } from "next/cache";
import { createApiToken, revokeApiToken } from "@hub/core";
import { requireUser } from "@/lib/session";

export async function createTokenAction(name: string): Promise<string> {
  const user = await requireUser();
  const { token } = await createApiToken(user.id, name || "Claude Code");
  revalidatePath("/get-started");
  return token;
}

export async function revokeTokenAction(fd: FormData) {
  const user = await requireUser();
  await revokeApiToken(user.id, String(fd.get("id")));
  revalidatePath("/get-started");
}
