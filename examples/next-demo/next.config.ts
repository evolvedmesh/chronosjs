import path from "node:path";
import type { NextConfig } from "next";

const root = path.join(import.meta.dirname, "../..");

const config: NextConfig = {
  // chronosjs is a workspace package outside this folder.
  turbopack: { root },
  outputFileTracingRoot: root,
  // Type checking runs separately with TypeScript 7 (`bun run typecheck`).
  typescript: { ignoreBuildErrors: true },
};

export default config;
