import { createI18n, type Lang, type Params } from '@genoffice/i18n'
import { strings } from './strings'

const translate = createI18n(strings)

type StringKey = keyof typeof strings.zh

let moduleLang: Lang = 'zh'

export const setModuleLang = (lang: Lang): void => {
  moduleLang = lang
}

/** Module-level translator used by the editor and the op executor. */
export const t = (key: StringKey, params?: Params): string => translate(moduleLang, key, params)
