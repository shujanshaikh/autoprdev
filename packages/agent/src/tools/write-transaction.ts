import { createHash } from "node:crypto";

export interface FileFingerprint {
  exists: boolean;
  bytes: number;
  sha256?: string;
}

export interface WriteTransactionIdentity {
  runId: string;
  toolCallId: string;
  remotePath: string;
  mode: "overwrite" | "append";
  contentSha256: string;
}

export interface WriteTransactionRecord extends WriteTransactionIdentity {
  version: 1;
  idempotencyKey: string;
  state: "prepared" | "committed";
  initial: FileFingerprint;
  final: FileFingerprint;
  result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFingerprint(value: unknown): value is FileFingerprint {
  return (
    isRecord(value) &&
    typeof value.exists === "boolean" &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 &&
    (value.exists
      ? typeof value.sha256 === "string" && /^[a-f0-9]{64}$/i.test(value.sha256)
      : value.bytes === 0 && value.sha256 === undefined)
  );
}

export function isWriteTransactionRecord(value: unknown): value is WriteTransactionRecord {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.idempotencyKey === "string" &&
    (value.state === "prepared" || value.state === "committed") &&
    typeof value.runId === "string" &&
    typeof value.toolCallId === "string" &&
    typeof value.remotePath === "string" &&
    (value.mode === "overwrite" || value.mode === "append") &&
    typeof value.contentSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(value.contentSha256) &&
    isFingerprint(value.initial) &&
    isFingerprint(value.final) &&
    "result" in value
  );
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createWriteIdempotencyKey(runId: string, toolCallId: string): string {
  return sha256Hex(`${runId}:${toolCallId}`);
}

export function fingerprintsEqual(left: FileFingerprint, right: FileFingerprint): boolean {
  return (
    left.exists === right.exists &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256
  );
}

export function assertWriteTransactionIdentity(
  record: WriteTransactionRecord,
  identity: WriteTransactionIdentity,
): void {
  for (const key of ["runId", "toolCallId", "remotePath", "mode", "contentSha256"] as const) {
    if (record[key] !== identity[key]) {
      throw new Error(
        `write idempotency conflict: ${key} changed for key ${record.idempotencyKey}`,
      );
    }
  }
}

export function classifyWriteTransactionRetry(
  record: WriteTransactionRecord,
  current: FileFingerprint,
): "already-committed" | "resume-prepared" {
  if (fingerprintsEqual(current, record.final)) {
    return "already-committed";
  }

  if (fingerprintsEqual(current, record.initial)) {
    return "resume-prepared";
  }

  throw new Error(
    `write retry refused because ${record.remotePath} no longer matches the recorded ` +
      `initial offset/hash or final offset/hash for idempotency key ${record.idempotencyKey}`,
  );
}
