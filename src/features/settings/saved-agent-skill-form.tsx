import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "../../shared/i18n/i18n";
import {
  getCommandErrorMessage,
  toCommandError,
} from "../../shared/commands/command-error";
import {
  listAgentSkills,
  saveSavedAgentSkill,
  type AgentSkillRecord,
  type AgentSkillScope,
  type SavedAgentSkillRecord,
} from "./settings-commands";
import { formatAgentTypeLabel, getAgentLogoSrc } from "../agents/agent-visuals";
import {
  orderSkillPathEntries,
  preferredSkillPathEntries,
} from "./saved-agent-skill-display";

interface SavedAgentSkillFormProps {
  skill?: SavedAgentSkillRecord;
  mode: "create" | "edit";
  onCancel: () => void;
  onSaved: (skill: SavedAgentSkillRecord) => void;
  projectId: number;
}

export function SavedAgentSkillForm({
  skill,
  mode,
  onCancel,
  onSaved,
  projectId,
}: SavedAgentSkillFormProps) {
  const { messages, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [scope, setScope] = useState<AgentSkillScope>(skill?.scope ?? "global");
  const [skillName, setSkillName] = useState(skill?.name ?? "");
  const [availableSkills, setAvailableSkills] = useState<AgentSkillRecord[]>(
    [],
  );
  const [skillsLoadState, setSkillsLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void listAgentSkills({
      projectId: scope === "project" ? projectId : null,
    })
      .then((result) => {
        if (!mounted) {
          return;
        }
        setAvailableSkills(result.skills);
        setSkillsLoadState("ready");
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setSkillsLoadState("error");
      });
    return () => {
      mounted = false;
    };
  }, [projectId, scope]);

  const handleScopeChange = useCallback((newScope: AgentSkillScope) => {
    setScope(newScope);
    setSkillName("");
    setNameError(null);
    setAvailableSkills([]);
    setSkillsLoadState("loading");
  }, []);

  const normalizedSkills = useMemo(() => {
    const skillMap = new Map<string, AgentSkillRecord[]>();
    for (const item of availableSkills) {
      const existing = skillMap.get(item.name) ?? [];
      existing.push(item);
      skillMap.set(item.name, existing);
    }
    return skillMap;
  }, [availableSkills]);

  const availableSkillNames = Array.from(normalizedSkills.keys()).sort();

  const scannedPaths = useMemo(() => {
    if (!skillName) {
      return [];
    }
    const records = normalizedSkills.get(skillName) ?? [];
    return orderSkillPathEntries(
      records.map((record) => ({
        agentType: record.agentType,
        path: record.path,
      })),
    );
  }, [skillName, normalizedSkills]);

  const displayPaths = useMemo(
    () => preferredSkillPathEntries(scannedPaths),
    [scannedPaths],
  );

  const handleSelectSkillName = (name: string) => {
    setSkillName(name);
    setSearchValue("");
    setOpen(false);
    setNameError(null);
  };

  function validateName(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return messages.settings.skillNameRequired;
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextNameError = validateName(skillName);
    setNameError(nextNameError);
    if (nextNameError || scannedPaths.length === 0) {
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const saved = await saveSavedAgentSkill({
        id: skill?.id,
        name: skillName.trim(),
        scope,
        projectId: scope === "project" ? projectId : null,
        skillPaths: scannedPaths,
      });
      onSaved(saved);
    } catch (error: unknown) {
      const commandError = toCommandError(error);
      if (commandError?.code === "DUPLICATE_NAME") {
        setNameError(messages.settings.skillNameDuplicate);
      } else {
        setStatusMessage(getCommandErrorMessage(error, t));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const dialogTitle =
    mode === "create"
      ? messages.settings.newSkill
      : messages.settings.editSkill;

  return (
    <div className="grid gap-4">
      <h4 className="text-sm font-semibold">{dialogTitle}</h4>

      <form
        className="grid gap-4"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label
              htmlFor="skill-scope"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.scope}
            </Label>
            <Select
              items={[
                { value: "project", label: messages.settings.projectScope },
                { value: "global", label: messages.settings.globalScope },
              ]}
              value={scope}
              onValueChange={(value) => {
                handleScopeChange(value as AgentSkillScope);
              }}
            >
              <SelectTrigger
                id="skill-scope"
                aria-label={messages.settings.scope}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">
                  {messages.settings.projectScope}
                </SelectItem>
                <SelectItem value="global">
                  {messages.settings.globalScope}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="skill-name"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.name}
            </Label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full justify-between"
                  id="skill-name"
                >
                  {skillName || messages.settings.selectSkillName}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder={messages.settings.searchSkillName}
                    value={searchValue}
                    onValueChange={setSearchValue}
                  />
                  <CommandList>
                    {skillsLoadState === "loading" ? (
                      <CommandEmpty>
                        {messages.settings.loadingSkills}
                      </CommandEmpty>
                    ) : skillsLoadState === "error" ? (
                      <CommandEmpty>
                        {messages.settings.skillLoadFailed}
                      </CommandEmpty>
                    ) : (
                      <>
                        <CommandEmpty>
                          {messages.settings.noMatches}
                        </CommandEmpty>
                        <CommandGroup>
                          {availableSkillNames
                            .filter((name) =>
                              name
                                .toLowerCase()
                                .includes(searchValue.toLowerCase()),
                            )
                            .map((name) => (
                              <CommandItem
                                key={name}
                                value={name}
                                onSelect={handleSelectSkillName}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    skillName === name
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {name}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {nameError ? (
              <span role="alert" className="text-xs text-destructive">
                {nameError}
              </span>
            ) : null}
          </div>

          {skillName && skillsLoadState === "ready" ? (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">
                {messages.settings.skillPaths}
              </Label>
              {displayPaths.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {messages.settings.notDetected}
                </p>
              ) : (
                <div className="max-h-48 overflow-auto rounded border border-border p-2">
                  {displayPaths.map((path, index) => (
                    <div
                      key={`${path.agentType}:${path.path}:${index}`}
                      className="flex items-center gap-2 py-1.5"
                    >
                      <img
                        alt={formatAgentTypeLabel(path.agentType)}
                        className="block size-4 shrink-0"
                        src={getAgentLogoSrc(path.agentType)}
                      />
                      <span className="shrink-0 text-sm font-medium">
                        {formatAgentTypeLabel(path.agentType)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {path.path}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {statusMessage ? (
          <p
            className="issue-dialog__status"
            role="status"
            aria-label={messages.settings.status}
          >
            {statusMessage}
          </p>
        ) : null}

        <div className="issue-dialog__footer issue-dialog__footer--end">
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={onCancel}
          >
            {messages.settings.cancel}
          </Button>
          <button
            className="issues-button issues-button--primary"
            type="submit"
            disabled={isSaving || scannedPaths.length === 0}
          >
            {isSaving ? messages.settings.saving : messages.settings.save}
          </button>
        </div>
      </form>
    </div>
  );
}
