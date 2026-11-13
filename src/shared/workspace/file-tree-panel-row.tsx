import { useContext, type ReactElement } from "react";
import type { NodeRendererProps } from "react-arborist";

import { isFileTreeDraftNodeId } from "./file-tree-create-draft";
import { FileTreeDraftRow, FileTreeRow } from "./file-tree-row";
import { FileTreeRowModelContext } from "./file-tree-row-model";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

export function FileTreePanelRow(
  props: NodeRendererProps<WorkspaceFileTreeNode>,
): ReactElement | null {
  const model = useContext(FileTreeRowModelContext);
  if (model === null) {
    return null;
  }
  if (isFileTreeDraftNodeId(props.node.data.id)) {
    return (
      <FileTreeDraftRow
        {...props}
        errorMessage={model.draftError?.message ?? null}
        errorRevision={model.draftError?.revision ?? 0}
        onCancel={model.cancelDraft}
        onSubmit={model.submitDraftName}
      />
    );
  }
  const rename =
    model.rename?.path === props.node.data.path ? model.rename : null;
  return (
    <FileTreeRow
      {...props}
      changedFileKinds={model.changedFileKinds}
      directoryKinds={model.directoryKinds}
      isMenuTarget={model.menuPath === props.node.data.path}
      onOpenFile={model.onOpenFile}
      onContextMenuNode={model.onContextMenuNode}
      rename={
        rename
          ? {
              errorMessage: rename.errorMessage,
              errorRevision: rename.errorRevision,
              generation: rename.generation,
              name: rename.name,
              onCancel: model.cancelRename,
              onChange: model.changeRenameName,
              onSubmit: (generation: number) => {
                void model.submitRename(generation);
              },
            }
          : null
      }
    />
  );
}
