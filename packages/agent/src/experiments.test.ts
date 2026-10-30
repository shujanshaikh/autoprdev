import { describe, expect, it } from "vite-plus/test";

import { parseHarnessExperiments } from "./experiments";

describe("parseHarnessExperiments", () => {
  it("keeps known experiments in a stable order and ignores unknown names", () => {
    expect(parseHarnessExperiments(undefined)).toEqual([]);
    expect(parseHarnessExperiments(" compact-tool-output, nope ,compact-prompt"))
      .toEqual(["compact-prompt", "compact-tool-output"]);
  });
});
