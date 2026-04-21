import "@autopr/env/web";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  typedRoutes: true,
  reactCompiler: true,
};

export default withWorkflow(nextConfig);
