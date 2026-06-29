import { LoaderCircle, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export interface LoadingDialogProps {
  closeLabel: string;
  message: string;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LoadingDialog({
  closeLabel,
  message,
  onOpenChange,
  open,
}: LoadingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(calc(100%-2rem),22rem)] gap-0 p-5"
        showCloseButton={false}
      >
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
        <div className="flex items-center gap-3 pr-8">
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
