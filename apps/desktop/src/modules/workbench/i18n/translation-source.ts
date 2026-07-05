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

// ponytail: pseudo-localization — 双写元音 + 全角括号包裹，测试布局溢出
// ceiling: 不模拟 CJK 全宽字符；升级路径：加 ICU lengthening 选项
const pseudoTransform = (value: string): string =>
  `［${value.replace(/[aeiouAEIOU]/g, (c) => c + c)}］`;

// ponytail: pseudo locale source — 包装 en-US bundle，对每个 value 做伪本地化变换
export const createPseudoLocaleSource = (
  id: string,
  baseBundle: TranslationBundle,
): TranslationSource => ({
  id,
  kind: "static" as const,
  loadBundle: (_locale: string): TranslationBundle => {
    const pseudoBundle: TranslationBundle = {};
    for (const key in baseBundle) {
      pseudoBundle[key] = pseudoTransform(baseBundle[key]!);
    }
    return pseudoBundle;
  },
});

// ponytail: LocalFileSource — 从预加载的 {locale: bundle} 映射创建翻译源
// 实际磁盘 I/O 由主进程 IPC handler 完成，渲染器通过 preload API 获取后传入
// ceiling: 同步 loadBundle 只适合已在内存中的 bundle；未来异步加载走 addResourceBundle
export const createLocalFileSource = (
  id: string,
  bundles: Readonly<Record<string, TranslationBundle>>,
): TranslationSource => ({
  id,
  kind: "local-file" as const,
  loadBundle: (locale: string): TranslationBundle => bundles[locale] ?? {},
});