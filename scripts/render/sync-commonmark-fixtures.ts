import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../..");
const FIXTURE_PATH = path.join(
  ROOT,
  "crates/lyra-render-core/tests/fixtures/commonmark-smoke.txt"
);

const SECTION_DELIMITER = "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~";

const CURATED_EXAMPLE_NAMES = [
  "atx_heading_h1",
  "atx_heading_h2",
  "setext_heading",
  "paragraph_text",
  "emphasis_and_strong",
  "inline_code",
  "link",
  "image",
  "unordered_list",
  "ordered_list",
  "blockquote",
  "fenced_code_block",
  "indented_code_block",
  "thematic_break_dash",
  "thematic_break_asterisk",
  "table",
  "strikethrough",
  "task_list",
  "nested_blockquote",
  "hard_break",
  "autolink_style_text",
  "nested_emphasis",
  "list_with_code",
  "reference_style_not_used",
  "escaped_chars"
] as const;

type CommonMarkSection = {
  name: string;
  markdown: string;
  html: string;
};

const parseArgs = (): { sourcePath: string | null; dryRun: boolean } => {
  const args = process.argv.slice(2);
  let sourcePath: string | null = null;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--source") {
      sourcePath = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--source=")) {
      sourcePath = arg.slice("--source=".length);
    }
  }

  return { sourcePath, dryRun };
};

const parseCommonMarkSections = (raw: string): CommonMarkSection[] => {
  const sections: CommonMarkSection[] = [];

  for (const chunk of raw.split(SECTION_DELIMITER)) {
    const section = chunk.trim();
    if (!section) {
      continue;
    }

    const lines = section.split("\n");
    const name = lines[0]?.trim() ?? "";
    if (!name) {
      continue;
    }

    let delimiterIndex = 0;
    while (delimiterIndex < lines.length && lines[delimiterIndex]?.trim() !== ".") {
      delimiterIndex += 1;
    }
    if (delimiterIndex >= lines.length) {
      continue;
    }

    const markdownLines: string[] = [];
    for (let index = delimiterIndex + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() === ".") {
        delimiterIndex = index;
        break;
      }
      markdownLines.push(line);
    }

    const htmlLines: string[] = [];
    for (let index = delimiterIndex + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() === ".") {
        break;
      }
      htmlLines.push(line);
    }

    if (markdownLines.length === 0) {
      continue;
    }

    sections.push({
      name,
      markdown: markdownLines.join("\n"),
      html: htmlLines.join("\n")
    });
  }

  return sections;
};

const serializeSection = (section: CommonMarkSection): string => {
  return [
    SECTION_DELIMITER,
    section.name,
    ".",
    section.markdown,
    ".",
    section.html,
    "."
  ].join("\n");
};

const main = (): void => {
  const { sourcePath, dryRun } = parseArgs();

  if (!sourcePath) {
    console.error(
      "Usage: pnpm render:sync-commonmark-fixtures -- --source /path/to/commonmark/spec.txt [--dry-run]"
    );
    process.exit(1);
  }

  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource)) {
    console.error(`Source file not found: ${resolvedSource}`);
    process.exit(1);
  }

  const source = fs.readFileSync(resolvedSource, "utf8");
  const sections = parseCommonMarkSections(source);
  const byName = new Map(sections.map((section) => [section.name, section]));

  const missing = CURATED_EXAMPLE_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    console.error(
      `Source is missing ${missing.length} curated example(s): ${missing.join(", ")}`
    );
    process.exit(1);
  }

  const output = CURATED_EXAMPLE_NAMES.map((name) =>
    serializeSection(byName.get(name)!)
  ).join("\n\n");

  if (dryRun) {
    console.log(output);
    return;
  }

  fs.writeFileSync(FIXTURE_PATH, `${output}\n`);
  console.log(
    `Wrote ${CURATED_EXAMPLE_NAMES.length} examples to ${path.relative(ROOT, FIXTURE_PATH)}`
  );
};

main();