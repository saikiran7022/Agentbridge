/** Built-in skill installed into every member's `.claude/skills/hub-liaison/SKILL.md`. */
export function hubLiaisonSkill(project: string): { slug: string; name: string; description: string; content: string } {
  return {
    slug: "hub-liaison",
    name: "hub-liaison",
    description:
      "Use when you need information, access or a change owned by another team (infra, devops, security, dev...) such as where a file or config value lives, secret locations, environments, pipelines, permissions or reviews. Ask that team's liaison agent through the hub MCP tools instead of guessing or asking the user to chase people.",
    content: `# Asking other teams through the Agent Liaison Hub

This repository belongs to the Hub project \`${project}\`. Every team on the project has a liaison agent that answers
on the team's behalf and escalates to a person when it has to.

## When to use it
- You need a fact another team owns: where a config value, secret, bucket, DNS record, pipeline or dashboard lives.
- You need a change outside this repo (permissions, infrastructure, CI settings) or a security review.
- Do not use it for things you can find in this repository yourself.

## How
1. \`list_projects\` shows the teams and who is on them (run it once if unsure which team owns something).
2. \`ask\` with \`team\` set (for example \`infra\`) and a self-contained question. Include file paths, environment names
   and error messages in \`context\`. Leave \`team\` empty to let the router choose.
3. If the result is not final, keep working on other parts of the task and call \`wait_for\` or \`get_answer\` later.
4. If the answer is incomplete, use \`follow_up\` on the same request instead of asking again.
5. Never paste secret values into questions. Answers will point to where secrets live (for example a Vault path), not the values.

## Answering for your own team
\`inbox\` lists requests escalated to you. Research the answer in this repository and reply with \`reply\`.
Approvers can \`approve\` or \`reject\` changes the agent proposes. Always confirm with the user before approving.
`,
  };
}
