declare module "monaco-editor/esm/vs/platform/actions/common/actions.js" {
  export class MenuId {
    static readonly EditorContext: MenuId;
  }

  export const MenuRegistry: {
    getMenuItems(id: MenuId): Array<{ command?: { id?: string } }>;
  };
}
