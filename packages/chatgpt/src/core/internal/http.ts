import { ChatGPTAuthError, type ChatGPTAuthErrorCode } from "../errors.ts";

/** Reads an HTTP response body without allowing body-read failures to mask the upstream status. */
export async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Parses a JSON response while preserving the package's typed error contract. */
export async function parseJson<T>(
  response: Response,
  code: ChatGPTAuthErrorCode,
  message: string,
): Promise<T> {
  try {
    return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json()) as T;
  } catch (cause) {
    throw new ChatGPTAuthError(code, message, { status: response.status, cause });
  }
}
