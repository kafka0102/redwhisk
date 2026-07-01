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
import {
  type SavedAgentSkillRecord,
} from "./settings-commands";
import { SavedAgentSkillForm } from "./saved-agent-skill-form";
import { formatAgentTypeLabel, getAgentLogoSrc } from "../agents/agent-visuals";
import { useI18n } from "../../shared/i18n/i18n";

interface AddSkillFormState {
  projectId: number;
}

interface EditingSkillState {
  contextProjectId: number;
  skill: SavedAgentSkillRecord;
}

interface SkillsSettingsPanelProps {
  addForm: AddSkillFormState | null;
  deletingSkillId: number | null;
  editingSkill: EditingSkillState | null;
  errorMessage: string | null;
  skills: SavedAgentSkillRecord[];
  loadState: "loading" | "ready" | "error";
  projectId: number;
  onAddFormChange: (form: AddSkillFormState | null) => void;
  onDeleteSkill: (skill: SavedAgentSkillRecord) => void;
  onEditingSkillChange: (state: EditingSkillState | null) => void;
  onSkillSaved: (skill: SavedAgentSkillRecord) => void;
}

export function SkillsSettingsPanel({
  addForm,
  deletingSkillId,
  editingSkill,
  errorMessage,
  skills,
  loadState,
  projectId,
  onAddFormChange,
  onDeleteSkill,
  onEditingSkillChange,
  onSkillSaved,
}: SkillsSettingsPanelProps) {
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
          {messages.settings.loadingSkills}
        </p>
      ) : skills.length === 0 ? (
        <Empty className="min-h-32 border border-border">
          <EmptyTitle>{messages.settings.noSkillsSaved}</EmptyTitle>
        </Empty>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-card">
          <Table
            aria-label={messages.settings.skills}
            className="min-w-[720px]"
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{messages.settings.name}</TableHead>
                <TableHead className="w-24">
                  {messages.settings.scope}
                </TableHead>
                <TableHead>{messages.settings.skillPaths}</TableHead>
                <TableHead className="w-40">
                  {messages.settings.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((skill) => (
                <TableRow key={skill.id}>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={skill.name}
                      className="grid h-auto w-full max-w-full justify-start gap-1 px-0 text-left font-semibold hover:bg-transparent"
                      onClick={() => {
                        onEditingSkillChange({
                          contextProjectId: projectId,
                          skill,
                        });
                        onAddFormChange(null);
                      }}
                    >
                      <span className="min-w-0 truncate">{skill.name}</span>
                    </Button>
                  </TableCell>
                  <TableCell>
                    {skill.scope === "global"
                      ? messages.settings.globalScope
                      : messages.settings.projectScope}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <div className="flex flex-wrap gap-1">
                      {skill.skillPaths.map((path, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          <img
                            alt={formatAgentTypeLabel(path.agentType)}
                            className="block size-3"
                            src={getAgentLogoSrc(path.agentType)}
                          />
                          <span className="truncate max-w-[200px]">
                            {path.path}
                          </span>
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      aria-label={`${messages.settings.delete} ${skill.name}`}
                      disabled={deletingSkillId === skill.id}
                      className={cn(
                        "h-auto p-0 font-semibold text-destructive hover:no-underline",
                      )}
                      onClick={() => {
                        onDeleteSkill(skill);
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
        <SavedAgentSkillForm
          key={`create-skill-${addForm.projectId}`}
          mode="create"
          projectId={addForm.projectId}
          onCancel={() => onAddFormChange(null)}
          onSaved={onSkillSaved}
        />
      ) : null}

      {editingSkill ? (
        <SavedAgentSkillForm
          key={`edit-skill-${editingSkill.skill.id}`}
          skill={editingSkill.skill}
          mode="edit"
          projectId={projectId}
          onCancel={() => onEditingSkillChange(null)}
          onSaved={onSkillSaved}
        />
      ) : null}
    </>
  );
}
