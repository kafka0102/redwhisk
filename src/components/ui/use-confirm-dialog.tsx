import { useCallback, useState, type ReactNode } from "react";

import {
  ConfirmContent,
  type ConfirmDialogOptions,
} from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/shared/i18n/i18n";

export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  confirmationDialog: ReactNode;
} {
  const { t } = useI18n();
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const [resolveConfirm, setResolveConfirm] = useState<
    ((confirmed: boolean) => void) | null
  >(null);

  const closeWithResult = useCallback(
    (confirmed: boolean) => {
      resolveConfirm?.(confirmed);
      setResolveConfirm(null);
      setOptions(null);
    },
    [resolveConfirm],
  );

  const confirm = useCallback(
    (nextOptions: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        if (resolveConfirm) {
          resolve(false);
          return;
        }

        setOptions(nextOptions);
        setResolveConfirm(() => resolve);
      }),
    [resolveConfirm],
  );

  const confirmationDialog = options ? (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeWithResult(false);
        }
      }}
    >
      <ConfirmContent
        cancelLabel={options.cancelLabel ?? t("confirmDialog.cancel")}
        confirmLabel={options.confirmLabel ?? t("confirmDialog.confirm")}
        confirmVariant={options.confirmVariant ?? "default"}
        message={options.message}
        title={options.title}
        onCancel={() => closeWithResult(false)}
        onConfirm={() => closeWithResult(true)}
      />
    </Dialog>
  ) : null;

  return { confirm, confirmationDialog };
}
