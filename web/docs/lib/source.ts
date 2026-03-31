import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

import { docsI18n } from "./i18n";
import { docsRoute } from "./shared";

export const source = loader({
  baseUrl: docsRoute,
  i18n: docsI18n,
  source: docs.toFumadocsSource()
});
