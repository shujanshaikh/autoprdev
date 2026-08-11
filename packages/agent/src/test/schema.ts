type SafeParseSchema = {
  safeParse(input: unknown): { success: boolean };
};

export function safeParse(schema: unknown, value: unknown): { success: boolean } {
  return (schema as SafeParseSchema).safeParse(value);
}
