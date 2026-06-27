import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-muted p-0.5 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-4 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
