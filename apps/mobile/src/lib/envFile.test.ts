import { describe, expect, it } from "vitest";

import { parseEnvFile } from "./envFile";

describe("parseEnvFile", () => {
  it("parses exports, quoted values, escapes, and comments", () => {
    expect(parseEnvFile([
      "export API_URL=https://example.test # production",
      "TOKEN='literal value'",
      'MULTILINE="first\\nsecond"',
    ].join("\n"))).toEqual({
      entries: [
        { envName: "API_URL", value: "https://example.test" },
        { envName: "TOKEN", value: "literal value" },
        { envName: "MULTILINE", value: "first\nsecond" },
      ],
      errors: [],
      duplicateNames: [],
    });
  });

  it("reports invalid, empty, duplicate, and unterminated assignments", () => {
    const result = parseEnvFile([
      "VALID=one",
      "VALID=two",
      "EMPTY=",
      "not an assignment",
      'BROKEN="value',
    ].join("\n"));

    expect(result.entries).toEqual([{ envName: "VALID", value: "two" }]);
    expect(result.duplicateNames).toEqual(["VALID"]);
    expect(result.errors).toHaveLength(3);
  });
});
