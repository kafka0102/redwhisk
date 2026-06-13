use std::path::Path;

use crate::agent_skill::index::AgentSkillIndex;

use super::scanner::{scan_global_skills, scan_project_skills};

pub struct AgentSkillService;

impl AgentSkillService {
    pub fn refresh_global_from_home(index: &AgentSkillIndex, home_dir: Option<&Path>) {
        index.set_global_loading();
        let skills = scan_global_skills(home_dir);
        index.replace_global(skills);
    }

    pub fn refresh_project(index: &AgentSkillIndex, project_id: i64, project_path: &Path) {
        index.set_project_loading(project_id);
        let skills = scan_project_skills(project_id, project_path);
        index.replace_project(project_id, skills);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use crate::agent_skill::index::AgentSkillIndex;
    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::AgentSkillRefreshStatus;

    use super::AgentSkillService;

    #[test]
    fn agent_skill_service_refresh_global_updates_index_to_ready() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        write_skill(&temp_dir.path().join(".agents/skills/global-codex"));
        let index = AgentSkillIndex::default();

        AgentSkillService::refresh_global_from_home(&index, Some(temp_dir.path()));

        let response = index.list(Some(AgentType::Codex), None);
        assert_eq!(response.global_status, AgentSkillRefreshStatus::Ready);
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.name == "global-codex"));
    }

    #[test]
    fn agent_skill_service_refresh_project_updates_project_index_to_ready() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        write_skill(&temp_dir.path().join(".claude/skills/project-claude"));
        let index = AgentSkillIndex::default();

        AgentSkillService::refresh_project(&index, 9, temp_dir.path());

        let response = index.list(Some(AgentType::Claude), Some(9));
        assert_eq!(response.project_status, AgentSkillRefreshStatus::Ready);
        assert!(response
            .skills
            .iter()
            .any(|skill| { skill.name == "project-claude" && skill.project_id == Some(9) }));
    }

    fn write_skill(skill_dir: &Path) {
        fs::create_dir_all(skill_dir).expect("skill dir");
        fs::write(skill_dir.join("SKILL.md"), "skill").expect("skill file");
    }
}
