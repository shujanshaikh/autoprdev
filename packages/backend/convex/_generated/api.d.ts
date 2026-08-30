/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as codexAuth from "../codexAuth.js";
import type * as crons from "../crons.js";
import type * as healthCheck from "../healthCheck.js";
import type * as imageUploads from "../imageUploads.js";
import type * as lib_agentPersistence from "../lib/agentPersistence.js";
import type * as lib_assistantPartsBlobs from "../lib/assistantPartsBlobs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_daytonaPreview from "../lib/daytonaPreview.js";
import type * as lib_gitStatus from "../lib/gitStatus.js";
import type * as lib_gitWorkflow from "../lib/gitWorkflow.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_githubPullRequest from "../lib/githubPullRequest.js";
import type * as lib_github_oauth from "../lib/github_oauth.js";
import type * as lib_sandboxCommandOutput from "../lib/sandboxCommandOutput.js";
import type * as lib_sandboxIdentity from "../lib/sandboxIdentity.js";
import type * as lib_threadWorktree from "../lib/threadWorktree.js";
import type * as lib_userSettings from "../lib/userSettings.js";
import type * as lib_uuid from "../lib/uuid.js";
import type * as messages from "../messages.js";
import type * as privateData from "../privateData.js";
import type * as projectActions from "../projectActions.js";
import type * as projects from "../projects.js";
import type * as recordingArtifactActions from "../recordingArtifactActions.js";
import type * as recordingArtifacts from "../recordingArtifacts.js";
import type * as sandboxCostActions from "../sandboxCostActions.js";
import type * as sandboxCosts from "../sandboxCosts.js";
import type * as threads from "../threads.js";
import type * as userSettings from "../userSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  codexAuth: typeof codexAuth;
  crons: typeof crons;
  healthCheck: typeof healthCheck;
  imageUploads: typeof imageUploads;
  "lib/agentPersistence": typeof lib_agentPersistence;
  "lib/assistantPartsBlobs": typeof lib_assistantPartsBlobs;
  "lib/auth": typeof lib_auth;
  "lib/daytonaPreview": typeof lib_daytonaPreview;
  "lib/gitStatus": typeof lib_gitStatus;
  "lib/gitWorkflow": typeof lib_gitWorkflow;
  "lib/github": typeof lib_github;
  "lib/githubPullRequest": typeof lib_githubPullRequest;
  "lib/github_oauth": typeof lib_github_oauth;
  "lib/sandboxCommandOutput": typeof lib_sandboxCommandOutput;
  "lib/sandboxIdentity": typeof lib_sandboxIdentity;
  "lib/threadWorktree": typeof lib_threadWorktree;
  "lib/userSettings": typeof lib_userSettings;
  "lib/uuid": typeof lib_uuid;
  messages: typeof messages;
  privateData: typeof privateData;
  projectActions: typeof projectActions;
  projects: typeof projects;
  recordingArtifactActions: typeof recordingArtifactActions;
  recordingArtifacts: typeof recordingArtifacts;
  sandboxCostActions: typeof sandboxCostActions;
  sandboxCosts: typeof sandboxCosts;
  threads: typeof threads;
  userSettings: typeof userSettings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
