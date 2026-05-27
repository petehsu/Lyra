// @ts-nocheck
import * as __fd_glob_23 from "../content/docs/workspace-tabs.zh-CN.mdx?collection=docs"
import * as __fd_glob_22 from "../content/docs/workspace-tabs.en-US.mdx?collection=docs"
import * as __fd_glob_21 from "../content/docs/workbench.zh-CN.mdx?collection=docs"
import * as __fd_glob_20 from "../content/docs/workbench.en-US.mdx?collection=docs"
import * as __fd_glob_19 from "../content/docs/topbar.zh-CN.mdx?collection=docs"
import * as __fd_glob_18 from "../content/docs/topbar.en-US.mdx?collection=docs"
import * as __fd_glob_17 from "../content/docs/search-home.zh-CN.mdx?collection=docs"
import * as __fd_glob_16 from "../content/docs/search-home.en-US.mdx?collection=docs"
import * as __fd_glob_15 from "../content/docs/quickstart.zh-CN.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/quickstart.en-US.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/linux-compat.zh-CN.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/linux-compat.en-US.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/lcp.zh-CN.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/lcp.en-US.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/index.zh-CN.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/index.en-US.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/file-manager.zh-CN.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/file-manager.en-US.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/file-editor.zh-CN.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/file-editor.en-US.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/architecture.zh-CN.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/architecture.en-US.mdx?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/meta.zh-CN.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.en-US.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.en-US.json": __fd_glob_0, "meta.zh-CN.json": __fd_glob_1, }, {"architecture.en-US.mdx": __fd_glob_2, "architecture.zh-CN.mdx": __fd_glob_3, "file-editor.en-US.mdx": __fd_glob_4, "file-editor.zh-CN.mdx": __fd_glob_5, "file-manager.en-US.mdx": __fd_glob_6, "file-manager.zh-CN.mdx": __fd_glob_7, "index.en-US.mdx": __fd_glob_8, "index.zh-CN.mdx": __fd_glob_9, "lcp.en-US.mdx": __fd_glob_10, "lcp.zh-CN.mdx": __fd_glob_11, "linux-compat.en-US.mdx": __fd_glob_12, "linux-compat.zh-CN.mdx": __fd_glob_13, "quickstart.en-US.mdx": __fd_glob_14, "quickstart.zh-CN.mdx": __fd_glob_15, "search-home.en-US.mdx": __fd_glob_16, "search-home.zh-CN.mdx": __fd_glob_17, "topbar.en-US.mdx": __fd_glob_18, "topbar.zh-CN.mdx": __fd_glob_19, "workbench.en-US.mdx": __fd_glob_20, "workbench.zh-CN.mdx": __fd_glob_21, "workspace-tabs.en-US.mdx": __fd_glob_22, "workspace-tabs.zh-CN.mdx": __fd_glob_23, });