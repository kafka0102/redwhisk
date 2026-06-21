import { Button, Empty, EmptyTitle } from "@/components/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { type AgentProfileRecord } from "./settings-commands";
import { AgentProfileForm } from "./agent-profile-form";
import { formatDefaultSkills } from "./agent-profile-skills";
import { formatAgentTypeLabel, getAgentLogoSrc } from "../agents/agent-visuals";
import { useI18n } from "../../shared/i18n/i18n";

interface AddFormState {
  projectId: number;
}

interface EditingProfileState {
  contextProjectId: number;
  profile: AgentProfileRecord;
}

interface AgentsSettingsPanelProps {
  addForm: AddFormState | null;
  deletingProfileId: number | null;
  editingProfile: EditingProfileState | null;
  errorMessage: string | null;
  loadState: "loading" | "ready" | "error";
  profiles: AgentProfileRecord[];
  projectId: number;
  onAddFormChange: (form: AddFormState | null) => void;
  onDeleteProfile: (profile: AgentProfileRecord) => void;
  onEditingProfileChange: (state: EditingProfileState | null) => void;
  onProfileSaved: (profile: AgentProfileRecord) => void;
}

export function AgentsSettingsPanel({
  addForm,
  deletingProfileId,
  editingProfile,
  errorMessage,
  loadState,
  profiles,
  projectId,
  onAddFormChange,
  onDeleteProfile,
  onEditingProfileChange,
  onProfileSaved,
}: AgentsSettingsPanelProps) {
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
          {messages.settings.loading}
        </p>
      ) : profiles.length === 0 ? (
        <Empty className="min-h-32 border border-border">
          <EmptyTitle>{messages.settings.noAgents}</EmptyTitle>
        </Empty>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-card">
          <Table
            aria-label={messages.settings.configuredAgents}
            className="min-w-[820px] [&_td]:text-sm [&_th]:text-sm"
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-14">{messages.settings.type}</TableHead>
                <TableHead>{messages.settings.name}</TableHead>
                <TableHead className="w-[22%]">
                  {messages.settings.command}
                </TableHead>
                <TableHead className="w-24">
                  {messages.settings.scope}
                </TableHead>
                <TableHead>{messages.settings.workflowSkill}</TableHead>
                <TableHead className="w-40">
                  {messages.settings.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => {
                const agentLabel = formatAgentTypeLabel(profile.agentType);
                const skills = formatDefaultSkills(profile.defaultSkill);

                return (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <img
                        alt={`Agent 类型：${agentLabel}`}
                        className="block size-[22px]"
                        src={getAgentLogoSrc(profile.agentType)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Edit ${profile.name}`}
                        className="h-auto max-w-full justify-start px-0 font-semibold hover:bg-transparent"
                        onClick={() => {
                          onEditingProfileChange({
                            contextProjectId: projectId,
                            profile,
                          });
                          onAddFormChange(null);
                        }}
                      >
                        <span className="min-w-0 truncate">{profile.name}</span>
                      </Button>
                    </TableCell>
                    <TableCell className="overflow-hidden font-mono text-muted-foreground">
                      <span className="block truncate">
                        {formatCommandName(profile.command)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {profile.scope === "global"
                        ? messages.settings.globalScope
                        : messages.settings.projectScope}
                    </TableCell>
                    <TableCell
                      data-slot="settings-agents-skill-cell"
                      className="overflow-hidden"
                    >
                      <span className="block truncate">
                        {skills.length > 0 ? skills : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="link"
                        aria-label={`${messages.settings.delete} ${profile.name}`}
                        disabled={deletingProfileId === profile.id}
                        className="h-auto p-0 font-semibold text-destructive hover:no-underline"
                        onClick={() => {
                          onDeleteProfile(profile);
                        }}
                      >
                        {messages.settings.delete}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {addForm ? (
        <AgentProfileForm
          key={`create-${addForm.projectId}`}
          mode="create"
          scope="global"
          projectId={addForm.projectId}
          onCancel={() => onAddFormChange(null)}
          onSaved={onProfileSaved}
        />
      ) : null}

      {editingProfile ? (
        <AgentProfileForm
          key={`edit-${editingProfile.profile.id}`}
          mode="edit"
          scope={editingProfile.profile.scope}
          projectId={projectId}
          profile={editingProfile.profile}
          onCancel={() => onEditingProfileChange(null)}
          onSaved={onProfileSaved}
        />
      ) : null}
    </>
  );
}

function formatCommandName(command: string): string {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) return "—";

  const normalizedCommand = trimmedCommand.replace(/\\/g, "/");
  const commandParts = normalizedCommand.split("/").filter(Boolean);
  return commandParts[commandParts.length - 1] ?? trimmedCommand;
}
