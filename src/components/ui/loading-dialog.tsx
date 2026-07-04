import { LoaderCircle, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export interface LoadingDialogProps {
  /** 关闭按钮的可访问名称，仅在 `dismissible` 为 `true` 时需要。 */
  closeLabel?: string;
  /** 是否允许用户手动关闭。阻塞式加载态设为 `false` 以隐藏关闭按钮并阻止 Esc/遮罩关闭。 */
  dismissible?: boolean;
  message: string;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LoadingDialog({
  closeLabel,
  dismissible = true,
  message,
  onOpenChange,
  open,
}: LoadingDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !dismissible) {
          return;
        }
        onOpenChange?.(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-[min(calc(100%-2rem),22rem)] gap-0 p-5"
        showCloseButton={false}
      >
        {dismissible ? (
          <DialogClose
            render={
              <Button
                aria-label={closeLabel}
                className="absolute top-2 right-2"
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        ) : null}
        <div className={`flex items-center gap-3 ${dismissible ? "pr-8" : ""}`}>
          <LoaderCircle
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin text-muted-foreground"
          />
          <DialogTitle className="text-sm leading-5 font-medium">
            {message}
          </DialogTitle>
        </div>
      </DialogContent>
    </Dialog>
  );
}
