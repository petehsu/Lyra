import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../utils";

export type AppSettingsRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  readonly control?: ReactNode;
  readonly description?: ReactNode;
  readonly title: ReactNode;
};

export const AppSettingsRow = ({
  className,
  control,
  description,
  title,
  ...props
}: AppSettingsRowProps) => (
  <div className={cn("lyra-settings-row", className)} {...props}>
    <span className="lyra-settings-row-copy">
      <strong>{title}</strong>
      {description === undefined ? null : <small>{description}</small>}
    </span>
    {control === undefined ? null : <span className="lyra-settings-row-control">{control}</span>}
  </div>
);
