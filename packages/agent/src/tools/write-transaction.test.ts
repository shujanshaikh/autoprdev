import { describe, expect, it } from "vitest";

import {
  assertWriteTransactionIdentity,
  classifyWriteTransactionRetry,
  createWriteIdempotencyKey,
  isWriteTransactionRecord,
  sha256Hex,
  type WriteTransactionRecord,
} from "./write-transaction";

function record(): WriteTransactionRecord {
  return {
    version: 1,
    idempotencyKey: createWriteIdempotencyKey("run_123", "tool_456"),
    state: "prepared",
    runId: "run_123",
    toolCallId: "tool_456",
    remotePath: "/workspace/file.txt",
    mode: "append",
    contentSha256: sha256Hex(" world"),
    initial: { exists: true, bytes: 5, sha256: sha256Hex("hello") },
    final: { exists: true, bytes: 11, sha256: sha256Hex("hello world") },
    result: { content: "appended", details: { path: "/workspace/file.txt" } },
  };
}

describe("write transaction idempotency", () => {
  it("derives stable keys from both the run and tool-call IDs", () => {
    expect(createWriteIdempotencyKey("run_123", "tool_456")).toBe(
      createWriteIdempotencyKey("run_123", "tool_456"),
    );
    expect(createWriteIdempotencyKey("run_123", "tool_456")).not.toBe(
      createWriteIdempotencyKey("run_123", "tool_789"),
    );
    expect(createWriteIdempotencyKey("run_123", "tool_456")).not.toBe(
      createWriteIdempotencyKey("run_999", "tool_456"),
    );
  });

  it("recognizes a committed append without applying it twice", () => {
    const transaction = record();
    expect(classifyWriteTransactionRetry(transaction, transaction.final)).toBe("already-committed");
  });

  it("resumes only while the original offset and hash still match", () => {
    const transaction = record();
    expect(classifyWriteTransactionRetry(transaction, transaction.initial)).toBe("resume-prepared");
    expect(() =>
      classifyWriteTransactionRetry(transaction, {
        exists: true,
        bytes: transaction.initial.bytes,
        sha256: sha256Hex("other"),
      }),
    ).toThrow(/offset\/hash/);
  });

  it("rejects reuse of a key with different content or destination", () => {
    const transaction = record();
    expect(() =>
      assertWriteTransactionIdentity(transaction, {
        runId: transaction.runId,
        toolCallId: transaction.toolCallId,
        remotePath: "/workspace/other.txt",
        mode: transaction.mode,
        contentSha256: transaction.contentSha256,
      }),
    ).toThrow(/remotePath changed/);
    expect(() =>
      assertWriteTransactionIdentity(transaction, {
        runId: transaction.runId,
        toolCallId: transaction.toolCallId,
        remotePath: transaction.remotePath,
        mode: transaction.mode,
        contentSha256: sha256Hex("different chunk"),
      }),
    ).toThrow(/contentSha256 changed/);
  });

  it("rejects malformed persistent records before using their offsets", () => {
    expect(isWriteTransactionRecord(record())).toBe(true);
    expect(isWriteTransactionRecord({ ...record(), final: { exists: true, bytes: -1 } })).toBe(false);
    expect(isWriteTransactionRecord({ ...record(), contentSha256: "not-a-hash" })).toBe(false);
  });
});
