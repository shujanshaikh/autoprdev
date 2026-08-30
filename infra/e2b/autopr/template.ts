import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Template, waitForPort } from "e2b";

const templateDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(templateDirectory, "../../..");
const daytonaSource = "infra/daytona/autopr";

// Daytona's Dockerfile remains the source of truth for system packages, CUA,
// FFF, Chrome, terminal tooling, and desktop configuration. The E2B SDK's
// Dockerfile parser normalizes shell escapes, so translate this file's small
// instruction subset into builder calls while preserving each RUN body.
const daytonaDockerfile = readFileSync(
  resolve(repositoryRoot, daytonaSource, "Dockerfile"),
  "utf8",
);

type DockerInstruction = { keyword: string; value: string };

function dockerInstructions(source: string): DockerInstruction[] {
  const instructions: DockerInstruction[] = [];
  let pending = "";

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!pending && (!line.trim() || line.trimStart().startsWith("#"))) continue;
    // Docker continuations are whitespace, not literal newlines in the
    // resulting RUN/ENV instruction. E2B's builder writes run commands
    // directly into a Dockerfile, so raw newlines would split one layer into
    // invalid top-level instructions.
    pending += `${pending ? " " : ""}${pending ? line.trimStart() : line}`;
    if (line.endsWith("\\")) {
      pending = pending.slice(0, -1);
      continue;
    }
    const match = pending.match(/^\s*([A-Za-z]+)\s+([\s\S]+)$/);
    if (match) instructions.push({ keyword: match[1]!.toUpperCase(), value: match[2]!.trim() });
    pending = "";
  }

  if (pending) throw new Error("The Daytona Dockerfile ends with an incomplete instruction.");
  return instructions;
}

function keyValues(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/\s+/).map((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw new Error(`Unsupported Docker key/value instruction: ${entry}`);
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const instructions = dockerInstructions(daytonaDockerfile);
const buildArguments = Object.fromEntries(instructions
  .filter((instruction) => instruction.keyword === "ARG")
  .map((instruction) => {
    const separator = instruction.value.indexOf("=");
    return separator < 0
      ? [instruction.value, ""]
      : [instruction.value.slice(0, separator), instruction.value.slice(separator + 1)];
  }));

let template = Template({ fileContextPath: repositoryRoot })
  .fromImage(process.env.E2B_BASE_IMAGE ?? buildArguments.DAYTONA_BASE_IMAGE ?? "ubuntu:24.04");

for (const instruction of instructions) {
  switch (instruction.keyword) {
    case "ARG": {
      const separator = instruction.value.indexOf("=");
      if (separator > 0) {
        template = template.setEnvs({
          [instruction.value.slice(0, separator)]: instruction.value.slice(separator + 1),
        });
      }
      break;
    }
    case "ENV":
      template = template.setEnvs(keyValues(instruction.value));
      break;
    case "RUN":
      template = template.runCmd(`bash -lc ${shellQuote(instruction.value)}`);
      break;
    case "COPY": {
      const [source, destination] = instruction.value.split(/\s+/);
      if (!source || !destination) throw new Error(`Unsupported Docker COPY: ${instruction.value}`);
      template = template.copy(
        source === "." ? daytonaSource : `${daytonaSource}/${source}`,
        destination,
      );
      break;
    }
    case "USER":
      template = template.setUser(instruction.value);
      break;
    case "FROM":
    case "SHELL":
    case "EXPOSE":
    case "ENTRYPOINT":
      break;
    default:
      throw new Error(`Unsupported Daytona Dockerfile instruction: ${instruction.keyword}`);
  }
}

export const autoprE2BTemplate = template
  .copy("infra/e2b/autopr/preview-gateway.mjs", "/opt/autopr/preview-gateway.mjs", {
    mode: 0o644,
    user: "root",
  })
  .copy("infra/e2b/autopr/autopr-desktop", "/opt/autopr/bin/autopr-desktop", {
    mode: 0o755,
    user: "root",
  })
  .copy("infra/e2b/autopr/autopr-xfce-session", "/opt/autopr/bin/autopr-xfce-session", {
    mode: 0o755,
    user: "root",
  })
  .copy("infra/e2b/autopr/autopr-git-askpass", "/opt/autopr/bin/autopr-git-askpass", {
    mode: 0o755,
    user: "root",
  })
  .runCmd(
    "install -d -m 0755 -o daytona -g daytona /home/daytona/.autopr /home/daytona/.autopr/recordings",
    { user: "root" },
  )
  .setUser("daytona")
  .setWorkdir("/home/daytona")
  .setStartCmd(
    "/opt/autopr/bin/autopr-desktop start-core && exec sleep infinity",
    waitForPort(6080),
  );
