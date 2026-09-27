// Shared by map discovery and input preparation. CSS visibility is inherited
// but children may override it; walking ancestors for visibility:hidden rejects
// real editors. Chromium also checks display:none and content-visibility:hidden
// ancestors. Opacity and pointer-events are separate interaction properties.
export const browserTargetVisibilityRuntime = String.raw`(element => {
  if (!element?.isConnected || !element.checkVisibility({ visibilityProperty: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
})`;
