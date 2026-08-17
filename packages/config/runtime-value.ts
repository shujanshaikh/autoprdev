import { z } from "zod";

export const jsonValueSchema = z.json();
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export type JsonPrimitive = boolean | null | number | string | undefined;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type ErrorCause = Error | JsonValue;

/** Parse an external value before it enters JSON-oriented application code. */
export function parseJsonValue<const Value>(value: Value) {
  return jsonValueSchema.parse(value);
}

/** Validate both an object's container and every recursively nested JSON value. */
export function isJsonObject<const Value>(value: Value): value is Value & JsonObject {
  return jsonObjectSchema.safeParse(value).success;
}
