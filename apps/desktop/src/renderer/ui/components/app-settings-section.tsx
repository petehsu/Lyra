import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../utils";

export type AppSettingsSectionProps = HTMLAttributes<HTMLElement> & {
  readonly children: ReactNode;
  readonly cluster?: boolean;
  readonly label: string;
  readonly titlePlacement?: "inside" | "outside" | "none";
};

export const AppSettingsSection = forwardRef<HTMLElement, AppSettingsSectionProps>(({
  children,
  className,
  cluster = false,
  label,
  titlePlacement = "inside",
  ...props
}, ref) => {
  const group = (
    <div className={cn("lyra-settings-group", cluster && "lyra-settings-group-cluster")}>
      {titlePlacement === "inside" ? (
        <header className="lyra-settings-group-header">
          <h3>{label}</h3>
        </header>
      ) : null}
      {children}
    </div>
  );

  if (titlePlacement === "inside") {
    return (
      <section
        ref={ref}
        className={cn("lyra-settings-section", className)}
        {...props}
      >
        {group}
      </section>
    );
  }

  return (
    <section
      ref={ref}
      className={cn("lyra-settings-section", className)}
      {...props}
    >
      {titlePlacement === "outside" ? (
        <h3 className="lyra-settings-section-title">{label}</h3>
      ) : null}
      {group}
    </section>
  );
});

AppSettingsSection.displayName = "AppSettingsSection";
