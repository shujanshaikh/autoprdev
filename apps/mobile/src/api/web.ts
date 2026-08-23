import { hasStringType } from "@autopr/config/runtime-type";

import { mobileConfig } from "../config";

type ErrorBody = {
  error?: string | { message?: string };
  message?: string;
};

export class WebRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WebRequestError";
  }
}

function errorMessage(body: ErrorBody | null, status: number) {
  if (hasStringType(body?.error)) return body.error;
  if (body?.error && hasStringType(body.error.message)) return body.error.message;
  if (hasStringType(body?.message)) return body.message;
  return `Request failed (${status}).`;
}

export async function webRequest<T>(
  path: string,
  accessToken: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const timeoutSignal = AbortSignal.timeout(30_000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(`${mobileConfig.webUrl}${path}`, {
      ...init,
      headers,
      signal,
    });
  } catch (error) {
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new WebRequestError("The request timed out. Try again.", 408);
    }
    throw error;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) satisfies ErrorBody | null;
    throw new WebRequestError(errorMessage(body, response.status), response.status);
  }
  return await response.json() satisfies T;
}
