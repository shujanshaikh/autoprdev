import { environmentSecretValues, redactSensitiveValues } from "./redaction";

const SESSION_PREFIX = "autopr-";
const SESSION_OWNER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface BackgroundProcessScope {
  readonly ownerId: string;
  readonly sessionPrefix: string;
  ownsSession(sessionId: string): boolean;
  registerCommand(
    sessionId: string,
    commandId: string,
    command: string,
    environment?: Record<string, string>,
  ): void;
  getCommand(sessionId: string, commandId: string): string | undefined;
  redactOutput(sessionId: string, commandId: string, output: string): string;
  forgetSession(sessionId: string): void;
}

type BackgroundCommandMetadata = {
  command: string;
  secrets: string[];
};

/**
 * Creates an unguessable capability shared only by one bash/process tool pair.
 * The optional owner ID exists for deterministic tests; production callers
 * always use a fresh random value.
 */
export function createBackgroundProcessScope(
  ownerId: string = crypto.randomUUID(),
): BackgroundProcessScope {
  if (!SESSION_OWNER_PATTERN.test(ownerId)) {
    throw new Error("Invalid background process owner ID.");
  }

  const sessionPrefix = `${SESSION_PREFIX}${ownerId}-`;
  const commands = new Map<string, Map<string, BackgroundCommandMetadata>>();

  return {
    ownerId,
    sessionPrefix,
    ownsSession: (sessionId) => sessionId.startsWith(sessionPrefix),
    registerCommand: (sessionId, commandId, command, environment) => {
      if (!sessionId.startsWith(sessionPrefix)) {
        throw new Error("Cannot register a background command owned by another agent run.");
      }

      let sessionCommands = commands.get(sessionId);
      if (!sessionCommands) {
        sessionCommands = new Map();
        commands.set(sessionId, sessionCommands);
      }
      sessionCommands.set(commandId, {
        command,
        secrets: environmentSecretValues(environment),
      });
    },
    getCommand: (sessionId, commandId) => commands.get(sessionId)?.get(commandId)?.command,
    redactOutput: (sessionId, commandId, output) => {
      const metadata = commands.get(sessionId)?.get(commandId);
      return redactSensitiveValues(output, metadata?.secrets ?? []);
    },
    forgetSession: (sessionId) => {
      commands.delete(sessionId);
    },
  };
}
