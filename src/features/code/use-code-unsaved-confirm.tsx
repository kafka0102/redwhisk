import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmContent } from "@/components/ui/confirm-dialog";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/shared/i18n/i18n";

export type SingleUnsavedChoice = "save" | "discard" | "cancel";
export type BulkUnsavedChoice = "saveAll" | "discardAll" | "cancel";

type PendingDialog = { kind: "single"; fileName: string } | { kind: "bulk" };

export function useCodeUnsavedConfirm(): {
  confirmSingleUnsaved: (fileName: string) => Promise<SingleUnsavedChoice>;
  confirmBulkUnsaved: () => Promise<BulkUnsavedChoice>;
  unsavedConfirmDialog: ReactNode;
} {
  const { messages } = useI18n();
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const singleResolverRef = useRef<
    ((choice: SingleUnsavedChoice) => void) | null
  >(null);
  const bulkResolverRef = useRef<((choice: BulkUnsavedChoice) => void) | null>(
    null,
  );

  const confirmSingleUnsaved = useCallback((fileName: string) => {
    return new Promise<SingleUnsavedChoice>((resolve) => {
      if (singleResolverRef.current || bulkResolverRef.current) {
        resolve("cancel");
        return;
      }
      singleResolverRef.current = resolve;
      setPending({ kind: "single", fileName });
    });
  }, []);

  const confirmBulkUnsaved = useCallback(() => {
    return new Promise<BulkUnsavedChoice>((resolve) => {
      if (singleResolverRef.current || bulkResolverRef.current) {
        resolve("cancel");
        return;
      }
      bulkResolverRef.current = resolve;
      setPending({ kind: "bulk" });
    });
  }, []);

  const closeSingle = useCallback((choice: SingleUnsavedChoice) => {
    const resolve = singleResolverRef.current;
    singleResolverRef.current = null;
    setPending(null);
    resolve?.(choice);
  }, []);

  const closeBulk = useCallback((choice: BulkUnsavedChoice) => {
    const resolve = bulkResolverRef.current;
    bulkResolverRef.current = null;
    setPending(null);
    resolve?.(choice);
  }, []);

  let unsavedConfirmDialog: ReactNode = null;
  if (pending?.kind === "single") {
    unsavedConfirmDialog = (
      <Dialog
        open
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeSingle("cancel");
          }
        }}
      >
        <ConfirmContent
          message={messages.agentsFeature.unsavedChangesMessage(
            pending.fileName,
          )}
          title={messages.agentsFeature.unsavedChangesTitle}
          footer={
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => closeSingle("discard")}
              >
                {messages.agentsFeature.unsavedChangesDontSave}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => closeSingle("cancel")}
              >
                {messages.agentsFeature.unsavedChangesCancel}
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={() => closeSingle("save")}
              >
                {messages.agentsFeature.unsavedChangesSave}
              </Button>
            </DialogFooter>
          }
        />
      </Dialog>
    );
  } else if (pending?.kind === "bulk") {
    unsavedConfirmDialog = (
      <Dialog
        open
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeBulk("cancel");
          }
        }}
      >
        <ConfirmContent
          message={messages.agentsFeature.unsavedChangesBulkMessage}
          title={messages.agentsFeature.unsavedChangesBulkTitle}
          footer={
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => closeBulk("discardAll")}
              >
                {messages.agentsFeature.unsavedChangesDontSaveAll}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => closeBulk("cancel")}
              >
                {messages.agentsFeature.unsavedChangesCancel}
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={() => closeBulk("saveAll")}
              >
                {messages.agentsFeature.unsavedChangesSaveAll}
              </Button>
            </DialogFooter>
          }
        />
      </Dialog>
    );
  }

  return {
    confirmSingleUnsaved,
    confirmBulkUnsaved,
    unsavedConfirmDialog,
  };
}
