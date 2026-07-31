export type MobileUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
};

export type MobileSession = {
  accessToken: string;
  refreshToken: string;
  organizationId?: string;
  user: MobileUser;
};

export type PromptFilePart = {
  type: "file";
  filename: string;
  mediaType: string;
  url: string;
  providerMetadata: { autopr: { r2Key: string } };
};

export type RootStackParamList = {
  Projects: undefined;
  Project: { projectId: string; title?: string; focusComposer?: boolean };
  NewTask: undefined;
  Thread: {
    projectId: string;
    threadId: string;
    title?: string;
    initialPrompt?: string;
    initialFiles?: PromptFilePart[];
    initialModel?: string;
    initialReasoningEffort?: string;
  };
  Changes: { projectId: string; threadId: string; title?: string };
  GitActions: { projectId: string; threadId: string; title?: string };
  GitCommit: { projectId: string; threadId: string; title?: string };
  Terminal: { projectId: string; threadId: string; title?: string };
  Environment: { projectId: string; title?: string };
  Branches: {
    projectId: string;
    owner: string;
    repo: string;
    currentBranch: string;
  };
  PullRequests: { projectId: string; title?: string };
  AddProject: undefined;
  Settings: undefined;
};

export type GitHubRepository = {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  private?: boolean;
};

export type GitHubBranch = {
  name: string;
  protected?: boolean;
};
