import { useState, type FormEvent } from "react";

import { Input } from "../../components/ui";
import { useI18n } from "../../shared/i18n/i18n";

interface SessionBrowserTabProps {
  initialUrl?: string | null;
}

export function SessionBrowserTab({
  initialUrl = null,
}: SessionBrowserTabProps) {
  const { messages } = useI18n();
  const [inputValue, setInputValue] = useState(initialUrl ?? "");
  const [currentUrl, setCurrentUrl] = useState<string | null>(
    initialUrl ? normalizeBrowserUrl(initialUrl) : null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextUrl = normalizeBrowserUrl(inputValue);
    if (nextUrl === null) {
      return;
    }

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
      <form className="session-browser-tab__bar" onSubmit={handleSubmit}>
        <Input
          aria-label={messages.agentsFeature.browserAddress}
          className="session-browser-tab__input"
          placeholder={messages.agentsFeature.browserAddressPlaceholder}
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
        />
      </form>
      <div className="session-browser-tab__surface">
        {currentUrl ? (
          <iframe
            key={`${currentUrl}:${reloadKey}`}
            className="session-browser-tab__frame"
            src={currentUrl}
            title={messages.agentsFeature.browserFrameTitle(currentUrl)}
          />
        ) : (
          <p className="session-browser-tab__empty">
            {messages.agentsFeature.browserEmpty}
          </p>
        )}
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
