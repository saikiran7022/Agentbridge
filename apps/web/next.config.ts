import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  transpilePackages: ["@hub/core", "@hub/db", "@hub/agent-templates", "@hub/mcp"],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "octokit", "nodemailer"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};

export default config;
