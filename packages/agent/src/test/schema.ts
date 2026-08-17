
type SafeParseSchema = {
  safeParse<InputValue>(input: InputValue): { success: boolean };
};

export function safeParse<SchemaValue, ValueValue>(schema: SchemaValue, value: ValueValue): { success: boolean } {
  return (/* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ schema as SafeParseSchema).safeParse(value);
}
