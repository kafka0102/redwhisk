type AppSurface =
  | {
      ownerWindowLabel: string;
      type: "session-monitor";
    }
  | { type: "project" };

export function resolveAppSurface(search: string): AppSurface {
  const params = new URLSearchParams(search);

  if (params.get("surface") !== "session-monitor") {
    return { type: "project" };
  }

  const ownerWindowLabel = params.get("ownerWindowLabel")?.trim();

  if (!ownerWindowLabel) {
    return { type: "project" };
  }

  return {
    ownerWindowLabel,
    type: "session-monitor",
  };
}
