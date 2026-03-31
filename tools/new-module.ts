import fs from "node:fs";
import path from "node:path";

const [, , targetDirArg, moduleNameArg] = process.argv;

if (!targetDirArg || !moduleNameArg) {
  console.error("Usage: pnpm new:module <target-dir> <module-name>");
  console.error("Example: pnpm new:module services/control-plane/src/modules task_router");
  process.exit(1);
}

const root = process.cwd();
const targetDir = path.resolve(root, targetDirArg);
const moduleName = moduleNameArg.trim();

if (!/^[a-z0-9_\-]+$/.test(moduleName)) {
  console.error("module-name must match: ^[a-z0-9_\\-]+$");
  process.exit(1);
}

const moduleDir = path.join(targetDir, moduleName);
if (fs.existsSync(moduleDir)) {
  console.error(`Module already exists: ${path.relative(root, moduleDir)}`);
  process.exit(1);
}

fs.mkdirSync(path.join(moduleDir, "tests"), { recursive: true });

const typeName = moduleName
  .split(/[_-]/g)
  .filter(Boolean)
  .map((seg) => seg[0].toUpperCase() + seg.slice(1))
  .join("");

fs.writeFileSync(
  path.join(moduleDir, "types.ts"),
  `export type ${typeName}Input = {\n  readonly id: string;\n};\n\nexport type ${typeName}Result = {\n  readonly ok: boolean;\n};\n`
);

fs.writeFileSync(
  path.join(moduleDir, "service.ts"),
  `import type { ${typeName}Input, ${typeName}Result } from "./types";\n\nexport const run${typeName} = (input: ${typeName}Input): ${typeName}Result => {\n  return { ok: input.id.length > 0 };\n};\n`
);

fs.writeFileSync(path.join(moduleDir, "index.ts"), `export * from "./types";\nexport * from "./service";\n`);

fs.writeFileSync(
  path.join(moduleDir, "tests", `${moduleName}.spec.md`),
  `# ${moduleName} tests\n\n- unit: run${typeName} should return ok=true for non-empty id\n- unit: run${typeName} should return ok=false for empty id\n`
);

console.log(`Created module scaffold: ${path.relative(root, moduleDir)}`);
