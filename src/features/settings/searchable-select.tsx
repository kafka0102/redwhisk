import { useRef, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SearchableSelectProps {
  ariaLabel: string;
  label: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  value: string;
}

// 通用可搜索下拉。原内联于 agent-profile-form；抽出后供 settings 表单复用。
// 不绑定具体业务字段，label/ariaLabel/options/value/onChange 由调用方提供。
export function SearchableSelect({
  ariaLabel,
  label,
  onChange,
  options,
  value,
}: SearchableSelectProps) {
  const { messages } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const displayValue = isOpen ? query : (selectedOption?.label ?? "");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        option.label.toLowerCase().includes(normalizedQuery),
      )
    : options;

  function commitOption(option: SearchableSelectOption) {
    onChange(option.value);
    setQuery("");
    setIsOpen(false);
  }

  return (
    <div
      className="settings-search-select"
      ref={rootRef}
      onBlur={(event) => {
        if (rootRef.current?.contains(event.relatedTarget as Node | null)) {
          return;
        }

        setQuery("");
        setIsOpen(false);
      }}
    >
      <label className="settings-field">
        <span>{label}</span>
        <input
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          autoCapitalize="none"
          className="settings-input settings-search-select__input"
          role="combobox"
          spellCheck={false}
          value={displayValue}
          onClick={() => {
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => {
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, filteredOptions.length - 1),
              );
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            }

            if (event.key === "Enter" && isOpen) {
              event.preventDefault();
              const option = filteredOptions[activeIndex];
              if (option) commitOption(option);
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
              setIsOpen(false);
            }
          }}
        />
      </label>
      {isOpen ? (
        <div className="settings-search-select__menu" role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                aria-selected={option.value === value}
                aria-label={
                  option.description
                    ? `${option.label} ${option.description}`
                    : option.label
                }
                className="settings-search-select__option"
                key={option.value}
                role="option"
                tabIndex={-1}
                type="button"
                data-active={index === activeIndex ? "true" : "false"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitOption(option)}
              >
                <span className="settings-search-select__option-label">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="settings-search-select__option-description">
                    {option.description}
                  </span>
                ) : null}
              </button>
            ))
          ) : (
            <p className="settings-search-select__empty">
              {messages.settings.noMatches}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
