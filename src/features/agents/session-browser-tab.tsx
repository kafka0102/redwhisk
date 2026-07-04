import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
} from "react";

import { Input } from "../../components/ui";
import { useI18n } from "../../shared/i18n/i18n";
import {
  filterRecentBrowserUrls,
  loadRecentBrowserUrls,
  rememberRecentBrowserUrl,
  saveRecentBrowserUrls,
} from "./session-browser-history";

interface SessionBrowserTabProps {
  initialUrl?: string | null;
}

export function SessionBrowserTab({
  initialUrl = null,
}: SessionBrowserTabProps) {
  const { messages } = useI18n();
  const browserBarRef = useRef<HTMLDivElement | null>(null);
  const normalizedInitialUrl = initialUrl
    ? normalizeBrowserUrl(initialUrl)
    : null;
  const [inputValue, setInputValue] = useState(normalizedInitialUrl ?? "");
  const [currentUrl, setCurrentUrl] = useState<string | null>(
    normalizedInitialUrl,
  );
  const [isRecentUrlsOpen, setIsRecentUrlsOpen] = useState(false);
  const [recentUrls, setRecentUrls] = useState<string[]>(() => {
    const initialRecentUrls = loadRecentBrowserUrls();
    if (normalizedInitialUrl === null) {
      return initialRecentUrls;
    }

    return rememberRecentBrowserUrl(normalizedInitialUrl, initialRecentUrls);
  });
  const [reloadKey, setReloadKey] = useState(0);
  const visibleRecentUrls = isRecentUrlsOpen
    ? filterRecentBrowserUrls(recentUrls, inputValue)
    : [];

  useEffect(() => {
    saveRecentBrowserUrls(recentUrls);
  }, [recentUrls]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextUrl = normalizeBrowserUrl(inputValue);
    if (nextUrl === null) {
      return;
    }

    navigateToUrl(nextUrl);
  }

  function handleBrowserBarFocus() {
    setIsRecentUrlsOpen(true);
  }

  function handleBrowserBarBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocusedTarget = event.relatedTarget;
    if (
      nextFocusedTarget instanceof Node &&
      browserBarRef.current?.contains(nextFocusedTarget)
    ) {
      return;
    }

    setIsRecentUrlsOpen(false);
  }

  function handleRecentUrlClick(url: string) {
    navigateToUrl(url);
  }

  function navigateToUrl(nextUrl: string) {
    setInputValue(nextUrl);
    setRecentUrls((currentRecentUrls) =>
      rememberRecentBrowserUrl(nextUrl, currentRecentUrls),
    );
    setIsRecentUrlsOpen(false);

    if (nextUrl === currentUrl) {
      setReloadKey((currentReloadKey) => currentReloadKey + 1);
      return;
    }

    setCurrentUrl(nextUrl);
  }

  return (
    <section
      aria-label={messages.agentsFeature.browserTab}
      className="session-browser-tab"
    >
      <div
        ref={browserBarRef}
        className="session-browser-tab__bar"
        onBlur={handleBrowserBarBlur}
        onFocus={handleBrowserBarFocus}
      >
        <form className="session-browser-tab__form" onSubmit={handleSubmit}>
          <Input
            aria-label={messages.agentsFeature.browserAddress}
            className="session-browser-tab__input"
            placeholder={messages.agentsFeature.browserAddressPlaceholder}
            type="text"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
        </form>
        {visibleRecentUrls.length > 0 ? (
          <div
            aria-label={messages.agentsFeature.browserRecentUrls}
            className="session-browser-tab__recent-urls"
          >
            {visibleRecentUrls.map((recentUrl) => (
              <button
                key={recentUrl}
                className="session-browser-tab__recent-url-button"
                type="button"
                onClick={() => handleRecentUrlClick(recentUrl)}
              >
                {recentUrl}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="session-browser-tab__surface">
        {currentUrl ? (
          <iframe
            key={`${currentUrl}:${reloadKey}`}
            className="session-browser-tab__frame"
            src={currentUrl}
            title={messages.agentsFeature.browserFrameTitle(currentUrl)}
          />
        ) : null}
      </div>
    </section>
  );
}

function normalizeBrowserUrl(value: string): string | null {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return `https://${trimmedValue}`;
}
