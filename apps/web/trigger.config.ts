import "dotenv/config";
import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF;

if (!project) {
  throw new Error("Set TRIGGER_PROJECT_REF before running or deploying Trigger.dev tasks.");
}

export default defineConfig({
  project,
  dirs: ["./src/trigger"],
  machine: "small-1x",
  maxDuration: 3_600,
  build: {
    // Daytona is CommonJS. Loading it as an external package preserves its
    // constructor exports instead of wrapping them in the Trigger bundle.
    external: ["@daytona/sdk"],
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
