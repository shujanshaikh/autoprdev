import { describe, expect, it } from "vitest";

import { formatCodexContextLimit } from "./codexModels";

describe("mobile Codex model metadata", () => {
  it.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])(
    "shows the ChatGPT catalog context for %s",
    (modelId) => {
      expect(formatCodexContextLimit(modelId)).toBe("272K context");
    },
  );
});
