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
  if (typeof body?.error === "string") return body.error;
  if (body?.error && typeof body.error.message === "string") return body.error.message;
  if (typeof body?.message === "string") return body.message;
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

  const response = await fetch(`${mobileConfig.webUrl}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new WebRequestError(errorMessage(body, response.status), response.status);
  }
  return await response.json() as T;
}
