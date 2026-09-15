import { createIcon } from "reicon-react/createIcon";

export const CirclePrimitive = createIcon("Circle", {
  O: '<circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  F: '<circle cx="12" cy="12" r="10" fill="currentColor"/>'
});

export const SquarePrimitive = createIcon("Square", {
  O: '<rect x="4.75" y="4.75" width="14.5" height="14.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  F: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor"/>'
});

// ponytail: Reicon UI has no git-branch glyph; this is the workbench source-control mark, not the Git diamond logo.
export const GitBranchPrimitive = createIcon("GitBranch", {
  O: '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.25"/><circle cx="6" cy="6" r="2.25"/><circle cx="18" cy="8.25" r="2.25"/><path d="M6 8.25v7.5"/><path d="M8.25 6c3.75 0 5.75.9 7.5 2.25"/></g>',
  F: '<g fill="currentColor"><circle cx="6" cy="18" r="2.75"/><circle cx="6" cy="6" r="2.75"/><circle cx="18" cy="8.25" r="2.75"/><rect x="5.25" y="8" width="1.5" height="8" rx="0.75"/><path d="M8.2 6.2c3.9.15 6.05 1.05 7.7 2.35l-1.1 1.1C13.4 8.5 11.2 7.75 8.2 7.6z"/></g>'
});
