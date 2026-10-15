/**
 * Opt-in harness changes under evaluation. Each is off unless listed, so the
 * default request shape stays unchanged until an experiment proves itself.
 *
 * - compact-prompt: shorter system prompt that describes tools instead of restating their descriptions.
 * - compact-tool-output: read numbers every 10th line; bash drops headers the model already knows.
 */
export const HARNESS_EXPERIMENTS = ["compact-prompt", "compact-tool-output"] as const;

export type HarnessExperiment = (typeof HARNESS_EXPERIMENTS)[number];

/** Parses a comma-separated list such as AUTOPR_HARNESS_EXPERIMENTS. Unknown names are ignored. */
export function parseHarnessExperiments(value: string | undefined): HarnessExperiment[] {
  const requested = new Set((value ?? "").split(",").map((name) => name.trim()));
  return HARNESS_EXPERIMENTS.filter((name) => requested.has(name));
}
