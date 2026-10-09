import type { Department, McpServer } from "@hub/db";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveMcpServer } from "../actions";

export function McpForm({ server, departments }: { server?: McpServer; departments: Department[] }) {
  return (
    <form action={saveMcpServer} className="space-y-4">
      {server && <input type="hidden" name="id" value={server.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" defaultValue={server?.name} placeholder="Kubernetes (read-only)" required />
        </Field>
        <Field label="Slug" hint="Used in resource names">
          <Input name="slug" defaultValue={server?.slug} placeholder="k8s" />
        </Field>
      </div>
      <Field label="Description" hint="Shown to admins and written into the kagent resource">
        <Input name="description" defaultValue={server?.description} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Owning department">
          <Select name="departmentId" defaultValue={server?.departmentId ?? ""}>
            <option value="">Shared</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Transport">
          <Select name="transport" defaultValue={server?.transport ?? "STREAMABLE_HTTP"}>
            <option value="STREAMABLE_HTTP">Remote: Streamable HTTP</option>
            <option value="SSE">Remote: SSE</option>
            <option value="STDIO">Container: stdio (kmcp)</option>
          </Select>
        </Field>
        <Field label="Access">
          <Select name="access" defaultValue={server?.access ?? "READ_ONLY"}>
            <option value="READ_ONLY">Read-only server</option>
            <option value="READ_WRITE">Can make changes</option>
          </Select>
        </Field>
      </div>
      <Field label="URL" hint="For remote servers, reachable from the kagent namespace">
        <Input name="url" defaultValue={server?.url ?? ""} placeholder="http://k8s-mcp.tools:8084/mcp" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Container image" hint="stdio only">
          <Input name="image" defaultValue={server?.image ?? ""} placeholder="ghcr.io/org/terraform-mcp:1.2" />
        </Field>
        <Field label="Command" hint="stdio only">
          <Input name="command" defaultValue={server?.command ?? ""} placeholder="npx" />
        </Field>
        <Field label="Arguments" hint="Space or comma separated">
          <Input name="args" defaultValue={server?.args.join(" ") ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Credential Secret" hint={<>Kubernetes Secret in the kagent namespace. Use <code>{"{project}"}</code> for per-project secrets.</>}>
          <Input name="secretName" defaultValue={server?.secretName ?? ""} placeholder="{project}-vault-mcp" />
        </Field>
        <Field label="Secret key">
          <Input name="secretKey" defaultValue={server?.secretKey ?? ""} placeholder="token" />
        </Field>
        <Field label="Header" hint="Remote servers only">
          <Input name="authHeader" defaultValue={server?.authHeader ?? "Authorization"} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Read tools" hint="Tools a read-only agent may call. Empty plus a read-only server means all tools.">
          <Textarea name="readTools" rows={4} defaultValue={server?.readTools.join("\n") ?? ""} placeholder={"k8s_get_resources\nk8s_describe_resource"} />
        </Field>
        <Field label="Write tools" hint="Only given to the approval-gated executor or autonomous agents">
          <Textarea name="writeTools" rows={4} defaultValue={server?.writeTools.join("\n") ?? ""} placeholder={"k8s_apply_manifest\nk8s_delete_resource"} />
        </Field>
      </div>
      <SubmitButton>{server ? "Save changes" : "Add MCP server"}</SubmitButton>
    </form>
  );
}
