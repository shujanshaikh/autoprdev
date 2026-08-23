import type { Doc } from "../_generated/dataModel";
import { r2 } from "../imageUploads";

type R2DeleteCtx = Parameters<typeof r2.deleteObject>[0];
type MessageBlobFields = Pick<Doc<"messages">, "partsR2Key" | "role">;

export type AssistantPartsBlobDeleteCtx = R2DeleteCtx;

export function collectAssistantPartsBlobKeys(messages: MessageBlobFields[]) {
  return Array.from(new Set(
    messages
      .filter((message) => message.role === "assistant" && message.partsR2Key)
      .map((message) => /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ message.partsR2Key as string),
  ));
}

export async function deleteAssistantPartsBlobKeys(ctx: R2DeleteCtx, keys: string[]) {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));

  await Promise.all(uniqueKeys.map((key) => r2.deleteObject(ctx, key)));
}

export async function deleteAssistantPartsBlobKeysBestEffort(ctx: R2DeleteCtx, keys: string[]) {
  try {
    await deleteAssistantPartsBlobKeys(ctx, keys);
  } catch (error) {
    console.warn("Failed to delete assistant message parts blob", error);
  }
}
