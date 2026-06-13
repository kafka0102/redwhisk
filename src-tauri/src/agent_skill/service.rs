use std::path::Path;

use crate::agent_skill::index::AgentSkillIndex;

use super::scanner::{scan_global_skill_result, scan_project_skills};

pub struct AgentSkillService;

impl AgentSkillService {
    pub fn refresh_global_from_home(index: &AgentSkillIndex, home_dir: Option<&Path>) {
        index.set_global_loading();
        let result = scan_global_skill_result(home_dir);
        if result.errors.is_empty() {
            index.replace_global(result.skills);
        } else {
            index.replace_global_with_error(result.skills, result.errors.join("; "));
        }
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

    #[cfg(unix)]
    #[test]
    fn agent_skill_service_refresh_global_preserves_readable_skills_and_records_root_errors() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = tempfile::tempdir().expect("temp dir");
        write_skill(&temp_dir.path().join(".agents/skills/readable-codex"));
        let unreadable_root = temp_dir.path().join(".codex/skills");
        fs::create_dir_all(&unreadable_root).expect("unreadable root");
        fs::set_permissions(&unreadable_root, fs::Permissions::from_mode(0o000))
            .expect("make unreadable");
        let index = AgentSkillIndex::default();

        AgentSkillService::refresh_global_from_home(&index, Some(temp_dir.path()));
        fs::set_permissions(&unreadable_root, fs::Permissions::from_mode(0o755))
            .expect("restore permissions");

        let response = index.list(Some(AgentType::Codex), None);
        assert!(response
            .skills
            .iter()
            .any(|skill| skill.name == "readable-codex"));
        assert_eq!(response.global_status, AgentSkillRefreshStatus::Failed);
        assert!(response
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains(&unreadable_root.to_string_lossy().to_string()));
    }

    fn write_skill(skill_dir: &Path) {
        fs::create_dir_all(skill_dir).expect("skill dir");
        fs::write(skill_dir.join("SKILL.md"), "skill").expect("skill file");
    }
}
