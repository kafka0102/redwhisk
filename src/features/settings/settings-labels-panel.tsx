import { Button, Empty, EmptyTitle } from "@/components/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { type ProjectLabelRecord } from "./settings-commands";
import { ProjectLabelForm } from "./project-label-form";
import { useI18n } from "../../shared/i18n/i18n";

interface AddLabelFormState {
  projectId: number;
}

interface EditingLabelState {
  contextProjectId: number;
  label: ProjectLabelRecord;
}

interface LabelsSettingsPanelProps {
  addForm: AddLabelFormState | null;
  deletingLabelId: number | null;
  editingLabel: EditingLabelState | null;
  errorMessage: string | null;
  labels: ProjectLabelRecord[];
  loadState: "loading" | "ready" | "error";
  projectId: number;
  onAddFormChange: (form: AddLabelFormState | null) => void;
  onDeleteLabel: (label: ProjectLabelRecord) => void;
  onEditingLabelChange: (state: EditingLabelState | null) => void;
  onLabelSaved: (label: ProjectLabelRecord) => void;
}

export function LabelsSettingsPanel({
  addForm,
  deletingLabelId,
  editingLabel,
  errorMessage,
  labels,
  loadState,
  projectId,
  onAddFormChange,
  onDeleteLabel,
  onEditingLabelChange,
  onLabelSaved,
}: LabelsSettingsPanelProps) {
  const { messages } = useI18n();

  return (
    <>
      {errorMessage ? (
        <p
          className="text-xs text-destructive"
          role="status"
          aria-label={messages.settings.status}
        >
          {errorMessage}
        </p>
      ) : null}

      {loadState === "loading" ? (
        <p className="grid min-h-24 place-items-center px-6 pt-2 text-xs text-muted-foreground">
          {messages.settings.loadingLabels}
        </p>
      ) : labels.length === 0 ? (
        <Empty className="min-h-32 border border-border">
          <EmptyTitle>{messages.settings.noLabels}</EmptyTitle>
        </Empty>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-card">
          <Table
            aria-label={messages.settings.labels}
            className="min-w-[720px]"
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{messages.settings.name}</TableHead>
                <TableHead className="w-24">
                  {messages.settings.scope}
                </TableHead>
                <TableHead>{messages.settings.color}</TableHead>
                <TableHead>{messages.settings.workflowSkill}</TableHead>
                <TableHead className="w-40">
                  {messages.settings.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.map((label) => (
                <TableRow key={label.id}>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={label.name}
                      className="grid h-auto w-full max-w-full justify-start gap-1 px-0 text-left font-semibold hover:bg-transparent"
                      onClick={() => {
                        onEditingLabelChange({
                          contextProjectId: projectId,
                          label,
                        });
                        onAddFormChange(null);
                      }}
                    >
                      <span className="min-w-0 truncate">{label.name}</span>
                    </Button>
                  </TableCell>
                  <TableCell>
                    {label.scope === "global"
                      ? messages.settings.globalScope
                      : messages.settings.projectScope}
                  </TableCell>
                  <TableCell>
                    <span
                      className="inline-block font-mono font-semibold"
                      style={{ color: label.color }}
                    >
                      {label.color}
                    </span>
                  </TableCell>
                  <TableCell
                    data-slot="settings-labels-skill-cell"
                    className="overflow-hidden"
                  >
                    <span className="block truncate">
                      {label.workflowSkill ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      aria-label={`${messages.settings.delete} ${label.name}`}
                      disabled={deletingLabelId === label.id}
                      className={cn(
                        "h-auto p-0 font-semibold text-destructive hover:no-underline",
                      )}
                      onClick={() => {
                        onDeleteLabel(label);
                      }}
                    >
                      {messages.settings.delete}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {addForm ? (
        <ProjectLabelForm
          key={`create-label-${addForm.projectId}`}
          mode="create"
          projectId={addForm.projectId}
          onCancel={() => onAddFormChange(null)}
          onSaved={onLabelSaved}
        />
      ) : null}

      {editingLabel ? (
        <ProjectLabelForm
          key={`edit-label-${editingLabel.label.id}`}
          label={editingLabel.label}
          mode="edit"
          projectId={projectId}
          onCancel={() => onEditingLabelChange(null)}
          onSaved={onLabelSaved}
        />
      ) : null}
    </>
  );
}
