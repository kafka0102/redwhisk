import { CircleAlert, CircleCheck, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type AlertDialogType = "error" | "info" | "success";

export interface AlertDialogOptions {
  message: string;
  type?: AlertDialogType;
}

export interface AlertDialogProps extends AlertDialogOptions {
  acknowledgeLabel: string;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}

const ALERT_DIALOG_ICON_CONFIG: Record<
  AlertDialogType,
  {
    className: string;
    Icon: typeof CircleAlert;
  }
> = {
  error: {
    className: "text-[var(--color-danger)]",
    Icon: CircleAlert,
  },
  info: {
    className: "text-[var(--color-lane-completed-marker)]",
    Icon: Info,
  },
  success: {
    className: "text-[var(--color-lane-review-marker)]",
    Icon: CircleCheck,
  },
};

export function AlertDialog({
  acknowledgeLabel,
  message,
  onOpenChange,
  open,
  type = "info",
}: AlertDialogProps) {
  const { Icon, className } = ALERT_DIALOG_ICON_CONFIG[type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-start gap-3 leading-6">
            <Icon
              aria-hidden="true"
              className={cn("mt-0.5 size-5 shrink-0", className)}
              data-slot="alert-dialog-icon"
              data-type={type}
              strokeWidth={2}
            />
            <span>{message}</span>
          </DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange?.(false)}>
            {acknowledgeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
