import { describe, expect, it } from "vitest";

import { getFileTypeIconName, pathParts } from "./file-type-icon";

describe("file type icons", () => {
  it("resolves language icons from a complete file path", () => {
    expect(getFileTypeIconName("/home/user/src/pages/index.astro")).toBe("astro");
    expect(getFileTypeIconName("src/styles/global.css")).toBe("css");
  });

  it("uses the library's file icon for an unknown extension", () => {
    expect(getFileTypeIconName("src/data/example.unknown-extension")).toBe("file");
  });

  it("keeps file names and parent paths separate", () => {
    expect(pathParts("src/pages/index.astro")).toEqual({
      name: "index.astro",
      dir: "src/pages",
    });
  });
});
