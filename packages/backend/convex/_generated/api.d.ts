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
import type * as commitMessages from "../commitMessages.js";
import type * as crons from "../crons.js";
import type * as healthCheck from "../healthCheck.js";
import type * as imageUploads from "../imageUploads.js";
import type * as lib_assistantPartsBlobs from "../lib/assistantPartsBlobs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_github_oauth from "../lib/github_oauth.js";
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
  commitMessages: typeof commitMessages;
  crons: typeof crons;
  healthCheck: typeof healthCheck;
  imageUploads: typeof imageUploads;
  "lib/assistantPartsBlobs": typeof lib_assistantPartsBlobs;
  "lib/auth": typeof lib_auth;
  "lib/github": typeof lib_github;
  "lib/github_oauth": typeof lib_github_oauth;
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
