import { defaultBuildLogger, Template } from "e2b";

import { autoprE2BTemplate } from "./template";

const build = await Template.build(autoprE2BTemplate, "autopr", {
  cpuCount: 8,
  memoryMB: 8_192,
  onBuildLogs: defaultBuildLogger(),
});

console.log(`Built E2B template ${build.templateId} (${build.buildId}).`);
