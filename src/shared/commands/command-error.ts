import type { TFunction } from "i18next";

export interface CommandErrorDetail {
  "@type": string;
  [key: string]: unknown;
}

export interface CommandError {
  code: string;
  message: string;
  reason?: string;
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

export function getCommandErrorMessage(error: unknown, t: TFunction): string {
  const commandError = toCommandError(error);
  const reason = commandError.reason ?? "default";
  const key = `errors.${commandError.code}.${reason}`;
  const url = getRemoteIssueUrl(commandError.details);
  const localized = url ? t(key, { url }) : t(key);
  const base =
    localized && localized !== key ? localized : commandError.message;
  const cause = getCauseDetailMessage(commandError.details);
  if (cause && !base.includes(cause)) {
    return `${base} ${cause}`.trim();
  }
  return base;
}

function getCauseDetailMessage(
  details: CommandError["details"] | undefined,
): string | null {
  if (!details) {
    return null;
  }
  for (const detail of details) {
    if (
      detail["@type"] === "Cause" &&
      typeof detail.message === "string" &&
      detail.message.trim().length > 0
    ) {
      return detail.message;
    }
  }
  return null;
}

function getRemoteIssueUrl(
  details: CommandError["details"] | undefined,
): string | null {
  if (!details) {
    return null;
  }
  for (const detail of details) {
    if (detail["@type"] !== "RemoteIssue") {
      continue;
    }
    const url = detail.url;
    if (typeof url === "string" && url.trim().length > 0) {
      return url.trim();
    }
  }
  return null;
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
