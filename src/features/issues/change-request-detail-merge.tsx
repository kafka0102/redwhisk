import type { JSX } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";
import { hostLabel, isMerged } from "./change-request-detail-model";

export function ChangeRequestDetailMerge({
  detail,
}: {
  detail: ChangeRequestDetail;
}): JSX.Element {
  const { t } = useI18n();
  const host = hostLabel(detail.provider);
  const merged = isMerged(detail.state);
  const blocked = detail.blockingReasons.length > 0;
  if (merged) {
    return (
      <section className="change-request-panel">
        <div className="change-request-panel__header">
          <h3>{t("issues.changeRequests.merge")}</h3>
          <span className="change-request-chip change-request-chip--merged">
            {t("issues.changeRequests.merged")}
          </span>
        </div>
        <p>
          {t("issues.changeRequests.mergedInto", {
            branch: detail.targetBranch,
          })}
        </p>
        {detail.mergeMethod ? (
          <p>
            {t("issues.changeRequests.mergeMethod")}: {detail.mergeMethod}
          </p>
        ) : null}
        {detail.mergeCommitSha ? (
          <p className="mono">
            {t("issues.changeRequests.mergeCommit")}: {detail.mergeCommitSha}
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void openUrl(detail.url);
          }}
        >
          {t("issues.changeRequests.viewOnHost", { host })}
        </Button>
      </section>
    );
  }
  return (
    <section className="change-request-panel">
      <div className="change-request-panel__header">
        <h3>{t("issues.changeRequests.merge")}</h3>
        <span
          className={`change-request-chip ${blocked ? "change-request-chip--danger" : "change-request-chip--success"}`}
        >
          {blocked
            ? t("issues.changeRequests.blocked")
            : t("issues.changeRequests.readyToMerge")}
        </span>
      </div>
      <p>{detail.mergeStateStatus ?? detail.mergeable ?? ""}</p>
      {detail.blockingReasons.length > 0 ? (
        <ul>
          {detail.blockingReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <label className="change-request-field">
        {t("issues.changeRequests.mergeMethod")}
        <select disabled defaultValue={detail.mergeMethod ?? "squash"}>
          <option value="squash">
            {t("issues.changeRequests.squashMerge")}
          </option>
          <option value="merge">
            {t("issues.changeRequests.createMergeCommit")}
          </option>
          <option value="rebase">
            {t("issues.changeRequests.rebaseMerge")}
          </option>
        </select>
      </label>
      <label className="change-request-checkline">
        <input type="checkbox" disabled />
        {t("issues.changeRequests.deleteSourceBranch")}
      </label>
      <Button type="button" disabled>
        {detail.provider === "gitlab"
          ? t("issues.changeRequests.mergeMergeRequest")
          : t("issues.changeRequests.mergePullRequest")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void openUrl(detail.url);
        }}
      >
        {t("issues.changeRequests.handleOnHost", { host })}
      </Button>
    </section>
  );
}
