import type { JSX } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";

export function ChangeRequestDetailFiles({
  detail,
}: {
  detail: ChangeRequestDetail;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="change-request-detail__stack">
      <section className="change-request-panel">
        <h3>{t("issues.changeRequests.filesTab")}</h3>
        <ul className="change-request-file-list">
          {detail.files.map((file) => (
            <li key={file.path} className="change-request-file-row">
              <span className="mono">{file.path}</span>
              <span className="mono">
                +{file.additions} −{file.deletions}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {detail.files.map((file) => (
        <section key={`${file.path}-patch`} className="change-request-panel">
          <h3 className="mono">{file.path}</h3>
          {file.patchStatus === "ready" && file.patch ? (
            <pre className="change-request-diff">{file.patch}</pre>
          ) : (
            <div className="change-request-file-fallback">
              <p>
                {file.patchStatus === "too_large"
                  ? t("issues.changeRequests.tooLargeDiff")
                  : file.patchStatus === "binary"
                    ? t("issues.changeRequests.binaryFile")
                    : t("issues.changeRequests.missingPatch")}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void openUrl(detail.url);
                }}
              >
                {t("issues.changeRequests.openHostForFile")}
              </Button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
