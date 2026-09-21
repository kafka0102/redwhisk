"use client";

import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "@/lib/utils";

// 右键菜单必须走 Base UI 的 ContextMenu.Root，而不是 Menu.Root。
// Menu.Root 按下拉菜单处理：启用 hover 关闭、outside-press 立刻生效、
// 且默认 side=bottom。贴窗口底部打开时菜单会翻到光标上方，指针落到
// backdrop 上，随后 mouseleave / 右键残留 pointer 会把菜单立刻关掉。
// ContextMenu.Root 会关闭 hover 关闭、给打开手势留 outside-press 宽限。
//
// 模态菜单会铺一层全屏 backdrop 接管指针命中：光标一旦落在菜单之外，行的
// :hover 会被 backdrop 抢走，落在光标坐标上的左键也会被当成 outside-press
// 吞掉。所以这里显式收紧 Positioner 偏移，让菜单在两条轴上都压住光标——
// Base UI 给 context menu 的默认 alignOffset 是 +2，会把光标留在菜单左边缘
// 之外，正是「右键后点菜单项不生效」的成因。
const CONTEXT_MENU_CURSOR_OVERLAP = 5;

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
  // 打开菜单的那次右键，其 mouseup 会落在刚弹出的菜单上（菜单压住光标，
  // 指针命中的就是菜单项）。Base UI 只在走 ContextMenu.Trigger 时才吞掉这
  // 次 mouseup（useMenuItemCommonProps 里的 initialCursorPoint 判断）；本组件
  // 用虚拟 anchor 自行管理开关，Base UI 会把这次 mouseup 当成「在菜单项上
  // 松开右键」再合成一次 click，于是菜单刚打开就被自己点掉。这里在 Popup
  // 捕获阶段吃掉这次右键 mouseup，保证「右键打开 → 左键点菜单项」稳定生效。
  const shouldSwallowOpeningMouseUpRef = React.useRef(false);
  React.useLayoutEffect(() => {
    shouldSwallowOpeningMouseUpRef.current = anchor !== null;
  }, [anchor]);
  const handlePopupMouseUpCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 2 || !shouldSwallowOpeningMouseUpRef.current) {
        return;
      }
      shouldSwallowOpeningMouseUpRef.current = false;
      event.stopPropagation();
    },
    [],
  );

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
        alignOffset={-CONTEXT_MENU_CURSOR_OVERLAP}
        className="isolate z-50 outline-none"
        side="bottom"
        sideOffset={-CONTEXT_MENU_CURSOR_OVERLAP}
        anchor={virtualAnchor}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
          onMouseUpCapture={handlePopupMouseUpCapture}
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
