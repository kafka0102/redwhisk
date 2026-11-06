import type { JSX } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

export function IssueDetailHeading({
  title,
  numberLabel,
  backLabel,
  disabled = false,
  onBack,
}: {
  title: string;
  numberLabel?: string;
  backLabel: string;
  disabled?: boolean;
  onBack: () => void;
}): JSX.Element {
  return (
    <div className="issue-detail-heading">
      <Button
        aria-label={backLabel}
        className="issues-button"
        disabled={disabled}
        type="button"
        variant="secondary"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.9} />
      </Button>
      <h2 className="issue-surface-header__title">
        {numberLabel ? (
          <>
            <span>{numberLabel}</span>
            {" · "}
            <span>{title}</span>
          </>
        ) : (
          title
        )}
      </h2>
    </div>
  );
}
