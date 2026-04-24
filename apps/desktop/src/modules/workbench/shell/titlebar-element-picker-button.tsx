import { Crosshair } from "lucide-react";

type TitlebarElementPickerButtonProps = {
  readonly active: boolean;
  readonly mode: "inspect" | "layout";
  readonly ariaLabel: string;
  readonly activeDescription: string | undefined;
  readonly onToggle: () => void;
};

export const TitlebarElementPickerButton = ({
  active,
  mode,
  ariaLabel,
  activeDescription,
  onToggle
}: TitlebarElementPickerButtonProps) => (
  <button
    type="button"
    className={
      active
        ? [
            "lyra-titlebar-navigation-action",
            "lyra-titlebar-picker-button",
            "lyra-titlebar-picker-button-active",
            mode === "layout" ? "lyra-titlebar-picker-button-layout" : ""
          ].filter(Boolean).join(" ")
        : "lyra-titlebar-navigation-action lyra-titlebar-picker-button"
    }
    aria-label={ariaLabel}
    aria-pressed={active}
    aria-description={active ? activeDescription : undefined}
    title={ariaLabel}
    onClick={onToggle}
  >
    <Crosshair size={14} />
  </button>
);
