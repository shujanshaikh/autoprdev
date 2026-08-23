export type ParsedEnvEntry = {
  envName: string;
  value: string;
};

export type EnvFileParseResult = {
  entries: ParsedEnvEntry[];
  errors: string[];
  duplicateNames: string[];
};

const ENV_ASSIGNMENT_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function hasEnvAssignmentLine(input: string): boolean {
  return input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .some((line) => ENV_ASSIGNMENT_PATTERN.test(line.trim()));
}

function decodeDoubleQuotedValue(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\" || index === value.length - 1) {
      decoded += character;
      continue;
    }

    const next = value[index + 1];
    if (next === "n") decoded += "\n";
    else if (next === "r") decoded += "\r";
    else if (next === '"') decoded += '"';
    else if (next === "\\") decoded += "\\";
    else decoded += `\\${next}`;
    index += 1;
  }
  return decoded;
}

function closingQuoteIndex(value: string, quote: "'" | '"'): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    if (quote === "'") return index;

    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return index;
  }
  return -1;
}

function unquotedValue(value: string): string {
  const commentIndex = value.search(/\s+#/);
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

export function parseEnvFile(input: string): EnvFileParseResult {
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const entriesByName = new Map<string, ParsedEnvEntry>();
  const errors: string[] = [];
  const duplicateNames = new Set<string>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const sourceLine = lines[lineIndex] ?? "";
    const trimmed = sourceLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const assignment = trimmed.match(ENV_ASSIGNMENT_PATTERN);
    if (!assignment) {
      errors.push(`Line ${lineIndex + 1}: expected NAME=value.`);
      continue;
    }

    const envName = assignment[1] ?? "";
    let rawValue = assignment[2] ?? "";
    let parsedValue: string;

    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const quote = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ rawValue[0] as "'" | '"';
      let closingIndex = closingQuoteIndex(rawValue, quote);
      while (closingIndex < 0 && lineIndex + 1 < lines.length) {
        lineIndex += 1;
        rawValue += `\n${lines[lineIndex] ?? ""}`;
        closingIndex = closingQuoteIndex(rawValue, quote);
      }

      if (closingIndex < 0) {
        errors.push(`Line ${lineIndex + 1}: ${envName} has an unterminated quoted value.`);
        continue;
      }

      const trailing = rawValue.slice(closingIndex + 1).trim();
      if (trailing && !trailing.startsWith("#")) {
        errors.push(`Line ${lineIndex + 1}: unexpected text after ${envName}.`);
        continue;
      }

      const quotedValue = rawValue.slice(1, closingIndex);
      parsedValue = quote === '"' ? decodeDoubleQuotedValue(quotedValue) : quotedValue;
    } else {
      parsedValue = unquotedValue(rawValue);
    }

    if (!parsedValue) {
      errors.push(`Line ${lineIndex + 1}: ${envName} has an empty value.`);
      continue;
    }

    if (entriesByName.has(envName)) duplicateNames.add(envName);
    entriesByName.set(envName, { envName, value: parsedValue });
  }

  return {
    entries: [...entriesByName.values()],
    errors,
    duplicateNames: [...duplicateNames],
  };
}
