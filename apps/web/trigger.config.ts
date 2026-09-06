import "dotenv/config";
import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF ?? "proj_utowwgzauraxgrxhwxie";

if (!project) {
  throw new Error("Set TRIGGER_PROJECT_REF before running or deploying Trigger.dev tasks.");
}

export default defineConfig({
  project,
  // Node 24 has crashed inside its native AES worker during long agent turns.
  // Keep Trigger tasks on Node 22 until that native failure is resolved upstream.
  runtime: "node-22",
  dirs: ["./src/trigger"],
  machine: "small-1x",
  maxDuration: 3_600,
  build: {
    // Keep runtime-loaded packages out of Trigger's JavaScript bundle. Sharp
    // must remain external because it loads a platform-specific native binary.
    external: ["@daytona/sdk", "busboy", "e2b", "form-data", "sharp"],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
});
