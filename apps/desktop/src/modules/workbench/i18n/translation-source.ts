// ponytail: TranslationSource trait — 翻译源抽象接口
// 当前只实现 StaticBundleSource（同步加载内置字典）
// 未来扩展路径：
//   - LocalFileSource：从本地翻译包目录加载 JSON bundle
//   - RemoteSource：从远程 URL 拉取翻译包
//   - PluginBundleSource：从插件 manifest.l10n 指定的目录加载
// 升级时 i18n-instance.ts 改为从 source 列表合并 resources，不改变 t() / formatMessage() API

export type TranslationBundle = Record<string, string>;

export type TranslationSourceKind =
  | "static"
  | "local-file"
  | "remote"
  | "plugin-bundle";

export interface TranslationSource {
  readonly id: string;
  readonly kind: TranslationSourceKind;
  loadBundle(locale: string): TranslationBundle | Promise<TranslationBundle>;
}

export const createStaticBundleSource = (
  id: string,
  bundles: Readonly<Record<string, TranslationBundle>>,
): TranslationSource => ({
  id,
  kind: "static" as const,
  loadBundle: (locale: string): TranslationBundle => bundles[locale] ?? {},
});