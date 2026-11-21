import { isAgentProfileTypeVisible } from "../../shared/agents/agent-profile-visibility";
import type { AgentProfileRecord } from "./settings-commands";

export function filterVisibleAgentProfiles(
  profiles: readonly AgentProfileRecord[],
): AgentProfileRecord[] {
  return profiles.filter((profile) =>
    isAgentProfileTypeVisible(profile.agentType),
  );
}
