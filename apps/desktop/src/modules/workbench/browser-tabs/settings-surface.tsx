import { useEffect, useMemo, useState } from "react";

import {
  buildSettingsCategoryDomId,
  createSettingsSurfaceModel
} from "./settings-render-model";
import { SettingsSurfaceView } from "./settings-surface-view";
import type { BrowserSettingsSurfaceProps } from "./settings-surface-types";
import type { SettingsCategoryId } from "./settings-schema";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type {
  BrowserSettingsCategoryFocusRequest,
  BrowserSettingsSurfaceProps
} from "./settings-surface-types";

export const BrowserSettingsSurface = (props: BrowserSettingsSurfaceProps) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(
    props.focusCategoryRequest?.categoryId ?? "general"
  );
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

  useEffect(() => {
    const categoryId = props.focusCategoryRequest?.categoryId;
    if (categoryId === undefined) {
      return;
    }
    setActiveCategory(categoryId);
    requestAnimationFrame(() => {
      scrollToCategory(categoryId);
    });
  }, [props.focusCategoryRequest?.categoryId, props.focusCategoryRequest?.requestId]);

  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: model.title,
      content: (
        <div className="lyra-titlebar-context-controls">
          {model.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={
                category.id === activeCategory
                  ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active"
                  : "lyra-titlebar-context-text-button"
              }
              onClick={() => {
                handleActivateCategory(category.id);
              }}
            >
              {category.navLabel}
            </button>
          ))}
        </div>
      )
    }),
    [activeCategory, model]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <SettingsSurfaceView
      model={model}
      activeCategory={activeCategory}
      onActivateCategory={handleActivateCategory}
      onCategoryPointerEnter={setActiveCategory}
    />
  );
};
