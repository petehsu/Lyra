import { createFirstPartyAppModule } from "@lyra/first-party-app-kit";

import { isRecord } from "./parse";
import { COMMANDS, FilesSurface } from "./surface";

export { parseFilesModuleState } from "./parse";
export type { FilesModuleState } from "./types";

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.files",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.files.refresh", title: "Refresh Files" },
      { id: "lyra.files.open-home", title: "Open Files home" }
    ],
    status: [
      { id: "lyra.files.status", title: "Files" }
    ]
  },
  commandHandlers: {
    "lyra.files.refresh": (host, input) =>
      host.executeCommand(COMMANDS.navigate, isRecord(input)
        ? { ...input, direction: "refresh" }
        : { direction: "refresh" }),
    "lyra.files.open-home": (host, input) =>
      host.executeCommand(COMMANDS.openHome, input)
  },
  surfaces: {
    "file-manager": {
      title: "Files",
      description: "Browse, search, organize, and open workspace files.",
      component: FilesSurface
    }
  }
});

export default lyraAppModule;
