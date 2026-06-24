export type ThreadDiffEntry = {
  id: string;
  messageId: string;
  partIndex: number;
  turn: number;
  tool: "edit" | "write";
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
  oldContent?: string | null;
  newContent?: string;
  diff: import("@/components/ai-elements/tool").ToolDiffPayload;
};
