use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::types::agent_profile::AgentType;
use crate::types::agent_skill::{
    AgentSkillListResponse, AgentSkillRecord, AgentSkillRefreshStatus, AgentSkillScope,
};

#[derive(Debug, Clone)]
pub struct AgentSkillIndex {
    inner: Arc<RwLock<AgentSkillIndexState>>,
}

#[derive(Debug, Default)]
struct AgentSkillIndexState {
    global_skills: Vec<AgentSkillRecord>,
    project_skills: HashMap<i64, Vec<AgentSkillRecord>>,
    global_status: AgentSkillRefreshStatus,
    project_statuses: HashMap<i64, AgentSkillRefreshStatus>,
    last_error: Option<String>,
}

impl Default for AgentSkillIndex {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(AgentSkillIndexState::default())),
        }
    }
}

impl AgentSkillIndex {
    pub fn list(
        &self,
        agent_type: Option<AgentType>,
        project_id: Option<i64>,
    ) -> AgentSkillListResponse {
        let state = self.inner.read().expect("agent skill index poisoned");
        let mut skills = filter_skills(&state.global_skills, agent_type.as_ref());

        if let Some(project_id) = project_id {
            if let Some(project_skills) = state.project_skills.get(&project_id) {
                skills.extend(filter_skills(project_skills, agent_type.as_ref()));
            }
        }

        AgentSkillListResponse {
            skills,
            global_status: state.global_status.clone(),
            project_status: project_id
                .and_then(|id| state.project_statuses.get(&id).cloned())
                .unwrap_or_default(),
            last_error: state.last_error.clone(),
        }
    }

    pub fn set_global_loading(&self) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.global_status = AgentSkillRefreshStatus::Loading;
        state.last_error = None;
    }

    pub fn set_project_loading(&self, project_id: i64) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state
            .project_statuses
            .insert(project_id, AgentSkillRefreshStatus::Loading);
        state.last_error = None;
    }

    pub fn replace_global(&self, skills: Vec<AgentSkillRecord>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.global_skills = skills;
        state.global_status = AgentSkillRefreshStatus::Ready;
        state.last_error = None;
    }

    pub fn replace_project(&self, project_id: i64, skills: Vec<AgentSkillRecord>) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        state.project_skills.insert(project_id, skills);
        state
            .project_statuses
            .insert(project_id, AgentSkillRefreshStatus::Ready);
        state.last_error = None;
    }

    pub fn mark_failed(
        &self,
        scope: AgentSkillScope,
        project_id: Option<i64>,
        error: impl Into<String>,
    ) {
        let mut state = self.inner.write().expect("agent skill index poisoned");
        match scope {
            AgentSkillScope::Global => {
                state.global_status = AgentSkillRefreshStatus::Failed;
            }
            AgentSkillScope::Project => {
                if let Some(project_id) = project_id {
                    state
                        .project_statuses
                        .insert(project_id, AgentSkillRefreshStatus::Failed);
                }
            }
        }
        state.last_error = Some(error.into());
    }
}

fn filter_skills(
    skills: &[AgentSkillRecord],
    agent_type: Option<&AgentType>,
) -> Vec<AgentSkillRecord> {
    skills
        .iter()
        .filter(|skill| {
            agent_type
                .map(|agent_type| &skill.agent_type == agent_type)
                .unwrap_or(true)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::{AgentSkillRecord, AgentSkillScope};

    use super::AgentSkillIndex;

    #[test]
    fn list_returns_global_and_matching_project_skills_for_agent_type() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![
            skill(
                "onespec",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/tmp/global/codex/onespec/SKILL.md",
            ),
            skill(
                "web-access",
                AgentType::Claude,
                AgentSkillScope::Global,
                None,
                "/tmp/global/claude/web-access/SKILL.md",
            ),
        ]);
        index.replace_project(
            7,
            vec![skill(
                "project-codex",
                AgentType::Codex,
                AgentSkillScope::Project,
                Some(7),
                "/tmp/repo/.agents/skills/project-codex/SKILL.md",
            )],
        );

        let response = index.list(Some(AgentType::Codex), Some(7));

        assert_eq!(response.skills.len(), 2);
        assert!(response
            .skills
            .iter()
            .all(|skill| skill.agent_type == AgentType::Codex));
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.scope == AgentSkillScope::Global));
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.scope == AgentSkillScope::Project));
    }

    #[test]
    fn list_preserves_duplicate_names_with_distinct_paths() {
        let index = AgentSkillIndex::default();
        index.replace_global(vec![
            skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/tmp/a/review/SKILL.md",
            ),
            skill(
                "review",
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
                "/tmp/b/review/SKILL.md",
            ),
        ]);

        let response = index.list(Some(AgentType::Codex), None);

        assert_eq!(response.skills.len(), 2);
        assert_ne!(response.skills[0].path, response.skills[1].path);
    }

    fn skill(
        name: &str,
        agent_type: AgentType,
        scope: AgentSkillScope,
        project_id: Option<i64>,
        path: &str,
    ) -> AgentSkillRecord {
        AgentSkillRecord {
            name: name.to_string(),
            path: path.to_string(),
            agent_type,
            scope,
            project_id,
            source_root: path
                .rsplit_once('/')
                .map(|(root, _)| root.to_string())
                .unwrap_or_else(|| path.to_string()),
        }
    }
}
