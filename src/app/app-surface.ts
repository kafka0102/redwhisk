type AppSurface =
  | {
      ownerWindowLabel: string;
      projectId: number;
      type: "session-monitor";
    }
  | { type: "project" };

export function resolveAppSurface(search: string): AppSurface {
  const params = new URLSearchParams(search);

  if (params.get("surface") !== "session-monitor") {
    return { type: "project" };
  }

  const projectId = Number(params.get("projectId"));
  const ownerWindowLabel = params.get("ownerWindowLabel")?.trim();

  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !ownerWindowLabel) {
    return { type: "project" };
  }

  return {
    ownerWindowLabel,
    projectId,
    type: "session-monitor",
  };
}
