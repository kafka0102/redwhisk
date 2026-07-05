import { useState, type ReactElement, type ReactNode } from "react";

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
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive";
  message: string;
  title?: string;
  onCancel?: () => void;
  onConfirm?: () => void;
  /**
   * 自定义 footer，传入后会完全替代默认的「取消 + 确认」按钮组合。
   * 不传时使用默认 footer，按钮文案与样式由上述 props 控制。
   */
  footer?: ReactNode;
}

export interface ConfirmDialogOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive";
  message: string;
  title?: string;
}

export interface ConfirmDialogProps extends ConfirmContentProps {
  children: ReactElement;
}

const DEFAULT_CANCEL_LABEL = "取消";
const DEFAULT_CONFIRM_LABEL = "确认";

export function ConfirmContent({
  cancelLabel = DEFAULT_CANCEL_LABEL,
  confirmLabel = DEFAULT_CONFIRM_LABEL,
  confirmVariant = "default",
  message,
  title,
  onCancel,
  onConfirm,
  footer,
}: ConfirmContentProps) {
  const defaultFooter = (
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="button" variant={confirmVariant} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </DialogFooter>
  );

  return (
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>{title ?? message}</DialogTitle>
        {title ? <DialogDescription>{message}</DialogDescription> : null}
      </DialogHeader>
      {footer ?? defaultFooter}
    </DialogContent>
  );
}

export function ConfirmDialog({
  cancelLabel = DEFAULT_CANCEL_LABEL,
  children,
  confirmLabel = DEFAULT_CONFIRM_LABEL,
  confirmVariant = "default",
  message,
  title,
  onCancel,
  onConfirm,
  footer,
}: ConfirmDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  function handleCancel() {
    setIsOpen(false);
    onCancel?.();
  }

  function handleConfirm() {
    setIsOpen(false);
    onConfirm?.();
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={children} />
      <ConfirmContent
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
        footer={footer}
        message={message}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        title={title}
      />
    </Dialog>
  );
}
