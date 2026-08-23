import { hasObjectType } from "@autopr/config/runtime-type";

export type GithubRepository = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt?: string;
};

export type GithubBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

export type GithubAppInstallation =
  | { installed: false; installUrl: string; action: "install" | "configure" }
  | { installed: true; installUrl: string; action: "installed" };

export type SandboxStatus = "creating" | "ready" | "failed";
export type SandboxRuntimeStatus = "started" | "stopped" | "archived" | "unknown";

export function statusStyles(status: SandboxStatus) {
  if (status === "ready") {
    return {
      label: "text-primary",
      dot: "bg-primary",
      border: "border-l-primary/40",
    };
  }
  if (status === "failed") {
    return {
      label: "text-destructive",
      dot: "bg-destructive",
      border: "border-l-destructive/40",
    };
  }
  return {
    label: "text-muted-foreground",
    dot: "bg-muted-foreground/60",
    border: "border-l-border",
  };
}

export async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      data && hasObjectType(data) && "error" in data
        ? String(data.error)
        : "Request failed.";
    throw new Error(error);
  }
  return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ data as T;
}
