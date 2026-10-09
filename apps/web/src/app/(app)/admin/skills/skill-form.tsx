import type { Department, Skill } from "@hub/db";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveSkill } from "../actions";

export function SkillForm({ skill, departments }: { skill?: Skill; departments: Department[] }) {
  return (
    <form action={saveSkill} className="space-y-4">
      {skill && <input type="hidden" name="id" value={skill.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" defaultValue={skill?.name} placeholder="Where configuration lives" required />
        </Field>
        <Field label="Slug" hint="Folder name under .claude/skills/">
          <Input name="slug" defaultValue={skill?.slug} placeholder="config-locations" />
        </Field>
      </div>
      <Field label="Description" hint="Claude Code reads this to decide when to use the skill">
        <Input name="description" defaultValue={skill?.description} placeholder="Use when you need to find where a config value or secret is defined" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Audience">
          <Select name="audience" defaultValue={skill?.audience ?? "BOTH"}>
            <option value="BOTH">Agents and people's Claude Code</option>
            <option value="AGENT">Liaison agents only</option>
            <option value="HUMAN">People's Claude Code only</option>
          </Select>
        </Field>
        <Field label="Owning department">
          <Select name="departmentId" defaultValue={skill?.departmentId ?? ""}>
            <option value="">Shared</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Instructions (Markdown)" hint="Runbooks, conventions, where things live. Never put secret values here.">
        <Textarea name="content" rows={14} defaultValue={skill?.content} required />
      </Field>
      <SubmitButton>{skill ? "Save changes" : "Add skill"}</SubmitButton>
    </form>
  );
}
