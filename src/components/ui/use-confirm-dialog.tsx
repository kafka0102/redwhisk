import { useCallback, useState, type ReactNode } from "react";

import {
  ConfirmContent,
  type ConfirmDialogOptions,
} from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";

export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  confirmationDialog: ReactNode;
} {
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
        cancelLabel={options.cancelLabel ?? "取消"}
        confirmLabel={options.confirmLabel ?? "确认"}
        confirmVariant={options.confirmVariant ?? "destructive"}
        message={options.message}
        title={options.title}
        onCancel={() => closeWithResult(false)}
        onConfirm={() => closeWithResult(true)}
      />
    </Dialog>
  ) : null;

  return { confirm, confirmationDialog };
}
