import {
  Button,
  Empty,
  EmptyTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { type SavedAgentSkillRecord } from "./settings-commands";
import { SavedAgentSkillForm } from "./saved-agent-skill-form";
import { formatAgentTypeLabel, getAgentLogoSrc } from "../agents/agent-visuals";
import { groupSupportedAgents } from "./saved-agent-skill-display";
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
                <TableHead className="w-40">{messages.settings.name}</TableHead>
                <TableHead className="w-24">
                  {messages.settings.scope}
                </TableHead>
                <TableHead className="w-80">
                  {messages.settings.supportedAgents}
                </TableHead>
                <TableHead className="w-40">
                  {messages.settings.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((skill) => {
                const handleEdit = () => {
                  onEditingSkillChange({ contextProjectId: projectId, skill });
                  onAddFormChange(null);
                };
                const supportedAgents = groupSupportedAgents(skill.skillPaths);

                return (
                  <TableRow key={skill.id}>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={skill.name}
                        className="grid h-auto w-full max-w-full justify-start gap-1 px-0 text-left font-semibold hover:bg-transparent"
                        onClick={handleEdit}
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
                      {supportedAgents.length === 0 ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger
                              type="button"
                              className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                            >
                              {messages.settings.notDetected}
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              {messages.settings.notDetectedTooltip}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {supportedAgents.map((agent) => (
                            <TooltipProvider key={agent.agentType}>
                              <Tooltip>
                                <TooltipTrigger
                                  type="button"
                                  className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                                >
                                  <img
                                    alt={formatAgentTypeLabel(agent.agentType)}
                                    className="block size-3 shrink-0"
                                    src={getAgentLogoSrc(agent.agentType)}
                                  />
                                  <span className="truncate">
                                    {formatAgentTypeLabel(agent.agentType)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm whitespace-pre-line">
                                  {agent.paths.join("\n")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${messages.settings.edit} ${skill.name}`}
                          className="h-auto px-0"
                          onClick={handleEdit}
                        >
                          {messages.settings.edit}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${messages.settings.delete} ${skill.name}`}
                          className="h-auto px-0 text-destructive hover:text-destructive"
                          disabled={deletingSkillId === skill.id}
                          onClick={() => {
                            void onDeleteSkill(skill);
                          }}
                        >
                          {messages.settings.delete}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {addForm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onAddFormChange(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-label={messages.settings.newSkill}
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-lg"
          >
            <SavedAgentSkillForm
              mode="create"
              projectId={projectId}
              onCancel={() => {
                onAddFormChange(null);
              }}
              onSaved={onSkillSaved}
            />
          </div>
        </div>
      ) : null}

      {editingSkill ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onEditingSkillChange(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-label={messages.settings.editSkill}
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-lg"
          >
            <SavedAgentSkillForm
              mode="edit"
              skill={editingSkill.skill}
              projectId={projectId}
              onCancel={() => {
                onEditingSkillChange(null);
              }}
              onSaved={onSkillSaved}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
