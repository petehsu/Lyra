"use client";

import { create } from "@orama/orama";
import { createTokenizer } from "@orama/tokenizers/mandarin";
import { useDocsSearch } from "fumadocs-core/search/client";
import { oramaStaticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps
} from "fumadocs-ui/components/dialog/search";
import { useI18n } from "fumadocs-ui/contexts/i18n";

const initOrama = (locale?: string) =>
  create({
    schema: { _: "string" },
    ...(locale === "zh-CN"
      ? { components: { tokenizer: createTokenizer() } }
      : { language: "english" as const })
  });

export const StaticSearchDialog = ({ open, onOpenChange }: SharedProps) => {
  const { locale } = useI18n();
  const { search, setSearch, query } = useDocsSearch({
    client: oramaStaticClient({
      from: "/api/search",
      initOrama,
      locale
    })
  });

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data === "empty" ? null : query.data} />
      </SearchDialogContent>
    </SearchDialog>
  );
};
