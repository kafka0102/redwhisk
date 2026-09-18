"use client";

import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "@/lib/utils";

// 右键菜单必须走 Base UI 的 ContextMenu.Root，而不是 Menu.Root。
// Menu.Root 按下拉菜单处理：启用 hover 关闭、outside-press 立刻生效、
// 且默认 side=bottom。贴窗口底部打开时菜单会翻到光标上方，指针落到
// backdrop 上，随后 mouseleave / 右键残留 pointer 会把菜单立刻关掉。
// ContextMenu.Root 会关闭 hover 关闭、给打开手势留 outside-press 宽限，
// 并用 fixed + 负 sideOffset 让菜单始终盖住光标。
interface ContextMenuAnchor {
  x: number;
  y: number;
}

function ContextMenu({
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return (
    <ContextMenuPrimitive.Root data-slot="context-menu" {...props}>
      {children}
    </ContextMenuPrimitive.Root>
  );
}

function ContextMenuContent({
  anchor,
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Popup> & {
  anchor?: ContextMenuAnchor | null;
}) {
  // 把菜单定位到鼠标坐标。anchor 为 null 时不定位（菜单此时不应 open）。
  const virtualAnchor = React.useMemo(() => {
    if (!anchor) {
      return null;
    }
    return {
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        x: anchor.x,
        y: anchor.y,
        top: anchor.y,
        left: anchor.x,
        right: anchor.x,
        bottom: anchor.y,
        toJSON: () => ({}),
      }),
    };
  }, [anchor]);

  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        align="start"
        className="isolate z-50 outline-none"
        anchor={virtualAnchor}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      className={cn(
        "group/context-menu-item relative flex min-h-8 cursor-default items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};
