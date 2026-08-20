export const BUILTIN_CODE_LANGUAGE_NAVIGATION_ACTION_IDS = [
  "editor.action.revealDefinition",
  "editor.action.goToReferences",
] as const;

export function filterEditorContextMenuItems<
  T extends { command?: { id?: string } },
>(items: T[]): T[] {
  const hidden = new Set<string>(BUILTIN_CODE_LANGUAGE_NAVIGATION_ACTION_IDS);
  return items.filter((item) => {
    const commandId = item.command?.id;
    return commandId == null || !hidden.has(commandId);
  });
}
