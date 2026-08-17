import { hasStringType } from "@autopr/config/runtime-type";


export function requireString<ValueValue>(value: ValueValue, name: string, toolName: string, options: { allowEmpty?: boolean } = {}): string {
  if (!hasStringType(value) || (!options.allowEmpty && value.length === 0)) {
    const qualifier = options.allowEmpty ? "string" : "non-empty string";
    throw new Error(`${toolName} requires a ${qualifier} \`${name}\` argument. Please retry with valid tool input.`);
  }

  return value;
}

export function requireArray<T>(value: T[] | undefined, name: string, toolName: string): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${toolName} requires a non-empty \`${name}\` array argument. Please retry with valid tool input.`);
  }

  return value;
}
