import { defineI18n } from "fumadocs-core/i18n";
import { defineI18nUI } from "fumadocs-ui/i18n";

export const docsI18n = defineI18n({
  languages: ["zh-CN", "en-US"],
  defaultLanguage: "zh-CN",
  parser: "dot",
  hideLocale: "never"
});

export type DocsLocale = (typeof docsI18n.languages)[number];

export const DEFAULT_DOCS_LOCALE: DocsLocale = docsI18n.defaultLanguage;

const LOCALE_SET = new Set<DocsLocale>(docsI18n.languages);

export const normalizeDocsLocale = (value: string | null | undefined): DocsLocale | null => {
  if (value !== null && value !== undefined && LOCALE_SET.has(value as DocsLocale)) {
    return value as DocsLocale;
  }
  return null;
};

export const docsUiI18n = defineI18nUI(docsI18n, {
  "zh-CN": {
    displayName: "简体中文",
    search: "搜索",
    searchNoResult: "未找到结果",
    toc: "本页目录",
    tocNoHeadings: "暂无标题",
    lastUpdate: "最后更新于",
    chooseLanguage: "选择语言",
    nextPage: "下一页",
    previousPage: "上一页",
    chooseTheme: "主题",
    editOnGithub: "在 GitHub 编辑"
  },
  "en-US": {
    displayName: "English (US)"
  }
});
