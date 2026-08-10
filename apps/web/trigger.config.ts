import "dotenv/config";
import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF ?? "proj_utowwgzauraxgrxhwxie";

if (!project) {
  throw new Error("Set TRIGGER_PROJECT_REF before running or deploying Trigger.dev tasks.");
}

export default defineConfig({
  project,
  dirs: ["./src/trigger"],
  machine: "small-1x",
  maxDuration: 3_600,
  build: {
    // Daytona relies on runtime-loaded CommonJS modules. Keep the SDK and its
    // multipart upload/download dependencies available to Trigger task runs.
    external: ["@daytona/sdk", "busboy", "form-data"],
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
