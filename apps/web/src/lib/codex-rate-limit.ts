import type { RateLimitBucket } from "@opencoredev/loginwithchatgpt-server";

export function mergeRateLimitBucket(latest: RateLimitBucket, proposed: RateLimitBucket) {
  if (latest.resetAt > proposed.resetAt) {
    return { ...latest, count: latest.count + 1 };
  }
  if (latest.resetAt === proposed.resetAt) {
    return { ...proposed, count: latest.count + 1 };
  }
  return proposed;
}
