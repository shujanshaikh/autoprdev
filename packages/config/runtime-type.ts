import { z } from "zod";

export type RuntimeTypeName =
  | "bigint"
  | "boolean"
  | "function"
  | "number"
  | "object"
  | "string"
  | "symbol"
  | "undefined";

type ParsedType<Value, Target> = Value extends null | undefined
  ? Extract<Value, Target>
  : [keyof Value] extends [never]
    ? Target
    : Extract<Value, Target>;

const bigintSchema = z.bigint();
const booleanSchema = z.boolean();
const functionSchema = z.function();
const numberSchema = z.number();
const objectSchema = z.custom<object>(
  (value) => value !== null && Object(value) === value,
);
const stringSchema = z.string();
const symbolSchema = z.symbol();
const undefinedSchema = z.undefined();

export function hasBigintType<const Value>(value: Value): value is Value & ParsedType<Value, bigint> {
  return bigintSchema.safeParse(value).success;
}

export function hasBooleanType<const Value>(value: Value): value is Value & ParsedType<Value, boolean> {
  return booleanSchema.safeParse(value).success;
}

export function hasFunctionType<const Value>(value: Value): value is Value & ParsedType<Value, Function> {
  return functionSchema.safeParse(value).success;
}

export function hasNumberType<const Value>(value: Value): value is Value & ParsedType<Value, number> {
  return numberSchema.safeParse(value).success || Object.is(value, Number.NaN);
}

export function hasObjectType<const Value>(value: Value): value is Value & ParsedType<Value, object | null> {
  return value === null || objectSchema.safeParse(value).success;
}

export function hasStringType<const Value>(value: Value): value is Value & ParsedType<Value, string> {
  return stringSchema.safeParse(value).success;
}

export function hasSymbolType<const Value>(value: Value): value is Value & ParsedType<Value, symbol> {
  return symbolSchema.safeParse(value).success;
}

export function hasUndefinedType<const Value>(value: Value): value is Value & ParsedType<Value, undefined> {
  return undefinedSchema.safeParse(value).success;
}

/** Parse a JavaScript value into the domain names exposed by the typeof operator. */
export function parseRuntimeType<const Value>(value: Value): RuntimeTypeName {
  if (hasUndefinedType(value)) return "undefined";
  if (hasStringType(value)) return "string";
  if (hasNumberType(value)) return "number";
  if (hasBooleanType(value)) return "boolean";
  if (hasBigintType(value)) return "bigint";
  if (hasSymbolType(value)) return "symbol";
  if (hasFunctionType(value)) return "function";
  if (hasObjectType(value)) return "object";

  // null is the only remaining JavaScript value and typeof reports it as object.
  return "object";
}
