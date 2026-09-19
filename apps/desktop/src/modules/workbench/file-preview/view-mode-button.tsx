import { BookOpen, Check, Eye, FileCode, SplitSquareHorizontal, SplitSquareVertical } from "@lyra/icons";
import {
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuTrigger,
  AppToolbarButton
} from "@renderer/ui/components";
import { t } from "@workbench/i18n";

import { previewKindFromPath, type FilePreviewLayout } from "./kinds";
import { setFilePreviewLayout, useFilePreviewLayout } from "./layout-store";

const OPTIONS: ReadonlyArray<{
  readonly value: FilePreviewLayout;
  readonly icon: typeof FileCode;
  readonly labelKey:
    | "editor.viewSource"
    | "editor.viewSplitHorizontal"
    | "editor.viewSplitVertical"
    | "editor.viewPreview";
}> = [
  { value: "source", icon: FileCode, labelKey: "editor.viewSource" },
  { value: "split-horizontal", icon: SplitSquareHorizontal, labelKey: "editor.viewSplitHorizontal" },
  { value: "split-vertical", icon: SplitSquareVertical, labelKey: "editor.viewSplitVertical" },
  { value: "preview", icon: Eye, labelKey: "editor.viewPreview" }
];

export const FilePreviewModeButton = ({
  filePath
}: {
  readonly filePath: string | null;
}) => {
  const kind = filePath === null ? null : previewKindFromPath(filePath);
  const layout = useFilePreviewLayout(filePath ?? "");
  if (filePath === null || kind === null) {
    return null;
  }
  const TriggerIcon = kind === "paper" ? BookOpen : Eye;
  return (
    <AppMenu>
      <AppMenuTrigger asChild>
        <AppToolbarButton
          type="button"
          className="lyra-titlebar-context-icon-button"
          aria-label={t("editor.viewMode")}
          title={t("editor.viewMode")}
        >
          <TriggerIcon size={14} />
        </AppToolbarButton>
      </AppMenuTrigger>
      <AppMenuContent align="end" className="lyra-file-preview-mode-menu">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <AppMenuItem
              key={option.value}
              className="lyra-app-menu-item-with-icon"
              onSelect={() => {
                setFilePreviewLayout(filePath, option.value);
              }}
            >
              <Icon size={14} aria-hidden="true" />
              <span className="lyra-app-menu-item-label">{t(option.labelKey)}</span>
              {layout === option.value ? <Check size={14} aria-hidden="true" /> : null}
            </AppMenuItem>
          );
        })}
      </AppMenuContent>
    </AppMenu>
  );
};
