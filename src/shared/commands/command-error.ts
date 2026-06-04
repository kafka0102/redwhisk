export interface CommandErrorDetail {
  "@type": string;
  [key: string]: unknown;
}

export interface CommandError {
  code: string;
  message: string;
  details?: CommandErrorDetail[];
}

export function isCommandError(value: unknown): value is CommandError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CommandError>;
  return (
    typeof candidate.code === "string" &&
    /^[A-Z][A-Z0-9_]*$/.test(candidate.code) &&
    typeof candidate.message === "string" &&
    hasValidDetails(candidate.details)
  );
}

export function toCommandError(value: unknown): CommandError {
  if (isCommandError(value)) {
    return value;
  }

  return {
    code: "UNKNOWN_COMMAND_ERROR",
    message:
      value instanceof Error
        ? value.message
        : (getObjectMessage(value) ?? String(value)),
  };
}

function hasValidDetails(
  details: CommandError["details"] | undefined,
): boolean {
  if (details === undefined) {
    return true;
  }

  return (
    Array.isArray(details) &&
    details.every(
      (detail) =>
        !!detail &&
        typeof detail === "object" &&
        typeof detail["@type"] === "string",
    )
  );
}

function getObjectMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { message?: unknown };
  return typeof candidate.message === "string" ? candidate.message : null;
}
