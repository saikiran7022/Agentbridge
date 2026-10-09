"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import { createTokenAction } from "./actions";

export function TokenCreator() {
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Token name, e.g. work laptop" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={pending} onClick={() => start(async () => setToken(await createTokenAction(name)))}>
          {pending ? "Creating..." : "Create token"}
        </Button>
      </div>
      {token && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="mb-1 font-medium text-emerald-800">Copy this now; it won't be shown again.</p>
          <code className="block break-all rounded bg-white p-2 font-mono text-xs">{token}</code>
        </div>
      )}
    </div>
  );
}
