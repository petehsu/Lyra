import {
  resolveLegalLocale,
  type LegalLocale
} from "./index";

export type LegalPageProps = {
  readonly searchParams: Promise<{
    readonly lang?: string | readonly string[];
  }>;
};

export async function localeFromPageProps(
  props: LegalPageProps
): Promise<LegalLocale> {
  const searchParams = await props.searchParams;
  return resolveLegalLocale(searchParams.lang);
}
