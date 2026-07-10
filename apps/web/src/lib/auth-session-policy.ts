/**
 * AuthKit otherwise reloads the whole document when its focus/visibility
 * session check cannot reach the server. Authentication remains enforced by
 * server handlers and Convex while transient failures keep client state alive.
 */
export const AUTHKIT_CLIENT_SESSION_POLICY = {
  onSessionExpired: false,
} as const;
