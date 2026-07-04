import { useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface ConfirmContentProps {
  cancelLabel: string;
  confirmLabel: string;
  confirmVariant: "default" | "destructive";
  message: string;
  title?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export interface ConfirmDialogOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive";
  message: string;
  title?: string;
}

export interface ConfirmDialogProps extends ConfirmDialogOptions {
  children: ReactElement;
  onConfirm: () => void;
}

export function ConfirmContent({
  cancelLabel,
  confirmLabel,
  confirmVariant,
  message,
  title,
  onCancel,
  onConfirm,
}: ConfirmContentProps) {
  return (
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>{title ?? message}</DialogTitle>
        {title ? <DialogDescription>{message}</DialogDescription> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={confirmVariant} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function ConfirmDialog({
  cancelLabel = "取消",
  children,
  confirmLabel = "确认",
  confirmVariant = "default",
  message,
  title,
  onConfirm,
}: ConfirmDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  function handleCancel() {
    setIsOpen(false);
  }

  function handleConfirm() {
    setIsOpen(false);
    onConfirm();
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={children} />
      <ConfirmContent
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
        message={message}
        title={title}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    </Dialog>
  );
}
