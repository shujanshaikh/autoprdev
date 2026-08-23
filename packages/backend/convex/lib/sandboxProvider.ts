import { v } from "convex/values";

export const sandboxProviders = ["daytona", "e2b"] as const;
export type SandboxProvider = (typeof sandboxProviders)[number];
export const sandboxProviderValidator = v.union(v.literal("daytona"), v.literal("e2b"));

/** Projects created before provider selection shipped are Daytona projects. */
export function resolvedSandboxProvider(provider?: SandboxProvider): SandboxProvider {
  return provider ?? "daytona";
}

export function sandboxProviderLabel(provider?: SandboxProvider): "Daytona" | "E2B" {
  return resolvedSandboxProvider(provider) === "e2b" ? "E2B" : "Daytona";
}
