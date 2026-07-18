export const BROWSER_RECENT_URLS_STORAGE_KEY =
  "redwhisk.agents.browserRecentUrls";
export const MAX_STORED_BROWSER_URLS = 100;
export const MAX_VISIBLE_BROWSER_URLS = 10;

export function loadRecentBrowserUrls(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(
      BROWSER_RECENT_URLS_STORAGE_KEY,
    );
    if (rawValue === null) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter((value): value is string => {
        return typeof value === "string" && value.trim().length > 0;
      })
      .slice(0, MAX_STORED_BROWSER_URLS);
  } catch {
    return [];
  }
}

export function rememberRecentBrowserUrl(
  url: string,
  currentRecentUrls: string[],
): string[] {
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return currentRecentUrls;
  }

  const nextRecentUrls = [
    trimmedUrl,
    ...currentRecentUrls.filter((recentUrl) => recentUrl !== trimmedUrl),
  ].slice(0, MAX_STORED_BROWSER_URLS);

  return nextRecentUrls;
}

export function filterRecentBrowserUrls(
  recentUrls: string[],
  query: string,
): string[] {
  const trimmedQuery = query.trim().toLowerCase();
  const matchingRecentUrls =
    trimmedQuery.length === 0
      ? recentUrls
      : recentUrls.filter((recentUrl) =>
          recentUrl.toLowerCase().includes(trimmedQuery),
        );

  return matchingRecentUrls.slice(0, MAX_VISIBLE_BROWSER_URLS);
}

export function saveRecentBrowserUrls(recentUrls: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      BROWSER_RECENT_URLS_STORAGE_KEY,
      JSON.stringify(recentUrls),
    );
  } catch {
    // Ignore persistence failures; runtime state still updates.
  }
}
