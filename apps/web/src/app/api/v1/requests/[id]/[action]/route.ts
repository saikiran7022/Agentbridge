import { notFound } from "@hub/core";
import { api, jsonBody } from "@/lib/api";
import { directHubApi } from "@/lib/hub-api";

export const POST = api<{ id: string; action: string }>(async (req, user, { id, action }) => {
  const body = await jsonBody<{ body?: string; answer?: string; note?: string; reason?: string }>(req);
  const hub = directHubApi(user);
  switch (action) {
    case "reply":
      return hub.reply(id, body.body ?? body.answer ?? "");
    case "approve":
      return hub.approve(id, body.note);
    case "reject":
      return hub.reject(id, body.reason ?? "");
    case "close":
      return hub.close(id);
    default:
      throw notFound(`Action "${action}"`);
  }
});
