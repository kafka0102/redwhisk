"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "@/lib/utils";

// 右键菜单基于 base-ui 的 Menu：受控 open + 把 Positioner 的 anchor 设为
// 鼠标坐标的虚拟元素，使菜单对齐光标而非某个触发元素。base-ui 没有独立的
// ContextMenu primitive，这是官方推荐的 context menu 实现方式。
//
// 使用方自己维护「右键的目标 + 光标坐标」状态：在目标元素上拦截 onContextMenu
// （preventDefault + 记录坐标），把坐标作为 ContextMenuContent 的 anchor，
// 并通过 ContextMenu 的 open/onOpenChange 控制开关。
interface ContextMenuAnchor {
  x: number;
  y: number;
}

function ContextMenu({ children, ...props }: MenuPrimitive.Root.Props) {
  return (
    <MenuPrimitive.Root data-slot="context-menu" {...props}>
      {children}
    </MenuPrimitive.Root>
  );
}

function ContextMenuContent({
  anchor,
  className,
  ...props
}: MenuPrimitive.Popup.Props & {
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
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align="start"
        className="isolate z-50 outline-none"
        side="bottom"
        sideOffset={0}
        anchor={virtualAnchor}
      >
        <MenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  inset,
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.Item
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
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
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
