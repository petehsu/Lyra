import { useMemo, useState } from "react";

import {
  buildSettingsCategoryDomId,
  createSettingsSurfaceModel
} from "./settings-render-model";
import { SettingsSurfaceView } from "./settings-surface-view";
import type { BrowserSettingsSurfaceProps } from "./settings-surface-types";
import type { SettingsCategoryId } from "./settings-schema";

export type { BrowserSettingsSurfaceProps } from "./settings-surface-types";

export const BrowserSettingsSurface = (props: BrowserSettingsSurfaceProps) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const model = useMemo(() => createSettingsSurfaceModel(props), [props]);

  const scrollToCategory = (categoryId: SettingsCategoryId): void => {
    const target = document.getElementById(buildSettingsCategoryDomId(categoryId));
    target?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const handleActivateCategory = (categoryId: SettingsCategoryId): void => {
    setActiveCategory(categoryId);
    scrollToCategory(categoryId);
  };

  return (
    <SettingsSurfaceView
      model={model}
      activeCategory={activeCategory}
      onActivateCategory={handleActivateCategory}
      onCategoryPointerEnter={setActiveCategory}
    />
  );
};
