import { useCallback, useState, type ReactNode } from "react";

import {
  AlertDialog,
  type AlertDialogOptions,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/shared/i18n/i18n";

export function useAlertDialog(): {
  alertDialog: ReactNode;
  showAlert: (options: AlertDialogOptions) => void;
} {
  const { messages } = useI18n();
  const [options, setOptions] = useState<AlertDialogOptions | null>(null);

  const closeAlert = useCallback(() => {
    setOptions(null);
  }, []);

  const showAlert = useCallback((nextOptions: AlertDialogOptions) => {
    setOptions(nextOptions);
  }, []);

  const alertDialog = options ? (
    <AlertDialog
      acknowledgeLabel={messages.alertDialog.acknowledge}
      message={options.message}
      open
      type={options.type}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeAlert();
        }
      }}
    />
  ) : null;

  return { alertDialog, showAlert };
}
