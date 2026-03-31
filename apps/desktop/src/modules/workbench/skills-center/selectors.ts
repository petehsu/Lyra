import type { InstalledSkillConfig, SkillSourceKind } from "../../../shared/skills";
import type {
  SkillsCenterSourceFilter,
  SkillsCenterState,
  SkillsCenterStatusFilter
} from "./types";

const selectSkillsForScope = (
  state: Pick<SkillsCenterState, "preferredScope" | "globalSkills" | "projectSkills">
): readonly InstalledSkillConfig[] =>
  state.preferredScope === "project" ? state.projectSkills : state.globalSkills;

const matchesStatusFilter = (
  skill: InstalledSkillConfig,
  filter: SkillsCenterStatusFilter
): boolean => {
  if (filter === "enabled") {
    return skill.enableState === "enabled";
  }
  if (filter === "disabled") {
    return skill.enableState === "disabled";
  }
  if (filter === "untrusted") {
    return skill.trustState === "untrusted";
  }
  return true;
};

const matchesSourceFilter = (
  sourceKind: SkillSourceKind,
  filter: SkillsCenterSourceFilter
): boolean => filter === "all" || sourceKind === filter;

const matchesCategoryFilter = (category: string, filter: string): boolean =>
  filter === "all" || category === filter;

export const selectVisibleSkills = (
  state: Pick<
    SkillsCenterState,
    | "preferredScope"
    | "statusFilter"
    | "sourceFilter"
    | "categoryFilter"
    | "globalSkills"
    | "projectSkills"
  >
): readonly InstalledSkillConfig[] =>
  selectSkillsForScope(state).filter(
    (skill) =>
      matchesStatusFilter(skill, state.statusFilter) &&
      matchesSourceFilter(skill.manifest.sourceKind, state.sourceFilter) &&
      matchesCategoryFilter(skill.manifest.category, state.categoryFilter)
  );
