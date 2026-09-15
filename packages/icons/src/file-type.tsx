"use client";

import { addCollection, Icon } from "@iconify/react/offline";
import { icons as vscodeIcons } from "@iconify-json/vscode-icons";

import { resolveFileTypeIconId, type FileTypeIconKind } from "./file-type-id";

addCollection(vscodeIcons);

export type FileTypeIconProps = {
  readonly name?: string;
  readonly filename?: string;
  readonly kind?: FileTypeIconKind;
  readonly size?: number | string;
  readonly className?: string;
};

export function FileTypeIcon({
  name,
  filename,
  kind = "file",
  size = 16,
  className
}: FileTypeIconProps) {
  const fileName = name ?? filename ?? "";
  return (
    <Icon
      icon={resolveFileTypeIconId(fileName, kind)}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    />
  );
}

export { resolveFileTypeIconId, type FileTypeIconKind };
