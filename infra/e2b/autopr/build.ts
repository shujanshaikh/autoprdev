import { defaultBuildLogger, Template } from "e2b";

import { autoprE2BTemplate } from "./template.ts";

const build = await Template.build(autoprE2BTemplate, "autopr-cua-e2b", {
  cpuCount: 2,
  memoryMB: 2_048,
  onBuildLogs: defaultBuildLogger(),
});

console.log(`Built E2B template ${build.templateId} (${build.buildId}).`);
