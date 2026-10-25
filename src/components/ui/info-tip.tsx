import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface InfoTipProps {
  label: string;
  text: string;
}

export function InfoTip({ label, text }: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-5 rounded-full text-[11px]"
            aria-label={label}
          >
            i
          </Button>
        }
      />
      <PopoverContent className="w-auto max-w-56 px-2 py-1.5 text-xs">
        {text}
      </PopoverContent>
    </Popover>
  );
}
