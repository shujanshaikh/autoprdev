import { hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import { api } from "@autopr/backend/convex/_generated/api";
import { useUploadFile } from "@convex-dev/r2/react";
import { useConvex } from "convex/react";
import type { FileUIPart } from "ai";
import { CircleAlert, ImagePlus, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { PromptInputButton, type PromptInputMessage, usePromptInputAttachments } from "@/components/ai-elements/prompt-input";

function isRecord<VValue>(v: VValue): v is VValue & (JsonObject) {
  return isJsonObject(v);
}

export type PromptAttachmentFile = PromptInputMessage["files"][number];

export type PromptImageUploadState =
  | { status: "uploading" }
  | { status: "uploaded"; part: FileUIPart }
  | { status: "error"; error: string };

export type PromptImageUploadManager = {
  imageUploadStates: Record<string, PromptImageUploadState>;
  uploadPromisesRef: RefObject<Map<string, Promise<void>>>;
  uploadImageFile: (file: File) => Promise<FileUIPart>;
  uploadImagePart: (part: FileUIPart) => Promise<FileUIPart>;
  resolveMessageImages: (files: PromptAttachmentFile[]) => Promise<FileUIPart[]>;
  removeImageUploadState: (id: string) => void;
  setImageUploadState: (id: string, state: PromptImageUploadState) => void;
};

function attachmentId(file: PromptAttachmentFile) {
  return hasStringType(file.id) ? file.id : null;
}

function filePartWithoutAttachmentId(file: PromptAttachmentFile): FileUIPart {
  const part = { ...file };
  delete part.id;

  return part;
}

function getR2KeyFromFilePart(part: FileUIPart) {
  if (!isRecord(part.providerMetadata)) {
    return null;
  }

  const autoprMetadata = part.providerMetadata.autopr;

  return isRecord(autoprMetadata) && hasStringType(autoprMetadata.r2Key)
    ? autoprMetadata.r2Key
    : null;
}

async function filePartToFile(part: FileUIPart) {
  const response = await fetch(part.url);

  if (!response.ok) {
    throw new Error(`Could not read ${part.filename ?? "image"} for upload.`);
  }

  const blob = await response.blob();
  const mediaType = part.mediaType || blob.type || "application/octet-stream";

  return new File([blob], part.filename ?? "image", {
    type: mediaType,
  });
}

function withR2ProviderMetadata(part: FileUIPart, key: string): FileUIPart {
  const autoprMetadata = isRecord(part.providerMetadata?.autopr)
    ? part.providerMetadata.autopr
    : {};

  return {
    ...part,
    providerMetadata: {
      ...part.providerMetadata,
      autopr: {
        ...autoprMetadata,
        r2Key: key,
      },
    },
  };
}

export function usePromptImageUploadManager(): PromptImageUploadManager {
  const [imageUploadStates, setImageUploadStates] = useState<Record<string, PromptImageUploadState>>({});
  const imageUploadStatesRef = useRef<Record<string, PromptImageUploadState>>({});
  const uploadPromisesRef = useRef<Map<string, Promise<void>>>(null!);
  uploadPromisesRef.current ??= new Map<string, Promise<void>>();
  const convex = useConvex();
  const uploadImage = useUploadFile(api.imageUploads);

  const setImageUploadState = useCallback((id: string, state: PromptImageUploadState) => {
    const next = {
      ...imageUploadStatesRef.current,
      [id]: state,
    };
    imageUploadStatesRef.current = next;
    setImageUploadStates(next);
  }, []);

  const removeImageUploadState = useCallback((id: string) => {
    if (!(id in imageUploadStatesRef.current)) {
      return;
    }

    const next = { ...imageUploadStatesRef.current };
    delete next[id];
    imageUploadStatesRef.current = next;
    setImageUploadStates(next);
  }, []);

  const uploadImageFile = useCallback(async (file: File) => {
    const key = await uploadImage(file);
    const url = await convex.query(api.imageUploads.getUrl, { key });

    return withR2ProviderMetadata({
      type: "file",
      filename: file.name,
      mediaType: file.type || "application/octet-stream",
      url,
    }, key);
  }, [convex, uploadImage]);

  const uploadImagePart = useCallback(async (part: FileUIPart) => {
    const file = await filePartToFile(part);
    const uploadedPart = await uploadImageFile(file);

    return {
      ...uploadedPart,
      filename: part.filename ?? uploadedPart.filename,
      mediaType: part.mediaType || uploadedPart.mediaType,
    };
  }, [uploadImageFile]);

  const resolveMessageImages = useCallback(async (files: PromptAttachmentFile[]) => {
    const imageFiles = files.filter((file) => file.mediaType.startsWith("image/"));

    if (imageFiles.length === 0) {
      return [];
    }

    await Promise.all(imageFiles.flatMap((file) => {
      const id = attachmentId(file);
      const pendingUpload = id ? uploadPromisesRef.current.get(id) : undefined;

      return pendingUpload ? [pendingUpload] : [];
    }));

    return await Promise.all(imageFiles.map(async (file) => {
      const id = attachmentId(file);
      const uploadState = id ? imageUploadStatesRef.current[id] : undefined;

      if (uploadState?.status === "uploaded") {
        return uploadState.part;
      }

      if (uploadState?.status === "error") {
        throw new Error(uploadState.error);
      }

      const part = filePartWithoutAttachmentId(file);

      if (getR2KeyFromFilePart(part)) {
        return part;
      }

      const uploadedPart = await uploadImagePart(part);

      if (id) {
        setImageUploadState(id, {
          status: "uploaded",
          part: uploadedPart,
        });
      }

      return uploadedPart;
    }));
  }, [setImageUploadState, uploadImagePart]);

  return {
    imageUploadStates,
    uploadPromisesRef,
    uploadImageFile,
    uploadImagePart,
    resolveMessageImages,
    removeImageUploadState,
    setImageUploadState,
  };
}

export function PromptImageUploadButton({ disabled }: { disabled: boolean }) {
  const attachments = usePromptInputAttachments();

  return (
    <PromptInputButton
      aria-label="Add photos"
      className="size-7 rounded-full bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-muted/40"
      disabled={disabled}
      onClick={() => attachments.openFileDialog()}
      tooltip="Add photos"
    >
      <ImagePlus className="size-3.5" aria-hidden />
    </PromptInputButton>
  );
}

export function PromptImageAttachments({
  disabled,
  manager,
}: {
  disabled: boolean;
  manager: PromptImageUploadManager;
}) {
  const attachments = usePromptInputAttachments();
  const imageFiles = attachments.files.filter((file) => file.mediaType.startsWith("image/"));
  const {
    imageUploadStates,
    removeImageUploadState,
    setImageUploadState,
    uploadImagePart,
    uploadPromisesRef,
  } = manager;

  useEffect(() => {
    const imageIds = new Set(imageFiles.map((file) => file.id));

    for (const id of Object.keys(imageUploadStates)) {
      if (!imageIds.has(id)) {
        removeImageUploadState(id);
      }
    }

    for (const file of imageFiles) {
      const id = file.id;

      if (imageUploadStates[id] || uploadPromisesRef.current.has(id)) {
        continue;
      }

      const part = filePartWithoutAttachmentId(file);
      if (getR2KeyFromFilePart(part)) {
        setImageUploadState(id, { status: "uploaded", part });
        continue;
      }

      const promise = (async () => {
        setImageUploadState(id, { status: "uploading" });

        try {
          const uploadedPart = await uploadImagePart(part);
          attachments.update(id, uploadedPart);
          setImageUploadState(id, { status: "uploaded", part: uploadedPart });
        } catch (error) {
          setImageUploadState(id, {
            status: "error",
            error: error instanceof Error ? error.message : "Image upload failed.",
          });
        }
      })();

      uploadPromisesRef.current.set(id, promise);
      void promise.finally(() => uploadPromisesRef.current.delete(id));
    }
  }, [
    attachments,
    imageFiles,
    imageUploadStates,
    removeImageUploadState,
    setImageUploadState,
    uploadImagePart,
    uploadPromisesRef,
  ]);

  if (imageFiles.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-wrap gap-2">
      {imageFiles.map((file) => {
        const uploadState = imageUploadStates[file.id];

        return (
          <div
            key={file.id}
            className="group/image relative size-14 overflow-hidden rounded-[var(--radius-md)] border border-border/50 bg-muted"
          >
            <img
              alt={file.filename ?? "Attached image"}
              className="h-full w-full object-cover"
              src={file.url}
            />
            {uploadState?.status === "uploading" ? (
              <output
                aria-label="Image upload in progress"
                className="absolute inset-0 grid place-items-center bg-background/70"
              >
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden />
              </output>
            ) : null}
            {uploadState?.status === "error" ? (
              <output
                aria-label="Image upload failed"
                className="absolute inset-0 grid place-items-center bg-destructive/15 text-destructive"
                title={uploadState.error}
              >
                <CircleAlert className="size-4" aria-hidden />
              </output>
            ) : null}
            <button
              type="button"
              aria-label={`Remove ${file.filename ?? "image"}`}
              className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground opacity-0 shadow-none transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/image:opacity-100"
              disabled={disabled}
              onClick={() => attachments.remove(file.id)}
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
