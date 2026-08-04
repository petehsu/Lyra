import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

import { FIRST_PARTY_APP_RELEASE_CONTRACTS_V1 } from "../components/first-party-app-release.ts";

const COMMAND_REGISTRY_FILES = [
  "apps/desktop/src/modules/workbench/workspace-apps/host-api.ts",
  "apps/desktop/src/modules/workbench/shell/use-workspace-core-command-bus.ts",
  "apps/desktop/src/modules/workbench/shell/use-workspace-agent-command-bus.ts"
] as const;

const parseSource = async (file: string): Promise<ts.SourceFile> =>
  ts.createSourceFile(
    file,
    await readFile(path.resolve(file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

const unwrap = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const propertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
};

const collectStringObjectMembers = (
  sourceFiles: readonly ts.SourceFile[]
): ReadonlyMap<string, string> => {
  const members = new Map<string, string>();
  for (const sourceFile of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer !== undefined
      ) {
        const initializer = unwrap(node.initializer);
        if (ts.isObjectLiteralExpression(initializer)) {
          for (const property of initializer.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const key = propertyName(property.name);
            const value = unwrap(property.initializer);
            if (key !== undefined && ts.isStringLiteral(value)) {
              members.set(`${node.name.text}.${key}`, value.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return members;
};

const resolveString = (
  expression: ts.Expression,
  objectMembers: ReadonlyMap<string, string>
): string | undefined => {
  const value = unwrap(expression);
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    return objectMembers.get(`${value.expression.text}.${value.name.text}`);
  }
  if (
    ts.isElementAccessExpression(value)
    && ts.isIdentifier(value.expression)
    && value.argumentExpression !== undefined
    && ts.isStringLiteral(unwrap(value.argumentExpression))
  ) {
    return objectMembers.get(
      `${value.expression.text}.${(unwrap(value.argumentExpression) as ts.StringLiteral).text}`
    );
  }
  return undefined;
};

const collectRegisteredHostPermissions = async (): Promise<ReadonlyMap<string, string | null>> => {
  const sourceFiles = await Promise.all(COMMAND_REGISTRY_FILES.map(parseSource));
  const objectMembers = collectStringObjectMembers(sourceFiles);
  const permissions = new Map<string, string | null>();

  for (const sourceFile of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const isCommand = node.expression.text === "registerWorkspaceCoreCommand";
        const isEvent = node.expression.text === "registerWorkspaceCoreEvent";
        if (isCommand || isEvent) {
          const idExpression = node.arguments[0];
          const permissionExpression = node.arguments[isCommand ? 2 : 1];
          assert.ok(idExpression, `Host registration in ${sourceFile.fileName} has no id`);
          assert.ok(
            permissionExpression,
            `Host registration in ${sourceFile.fileName} has no access declaration`
          );
          const id = resolveString(idExpression, objectMembers);
          const permissionValue = unwrap(permissionExpression);
          const permission = permissionValue.kind === ts.SyntaxKind.NullKeyword
            ? null
            : resolveString(permissionValue, objectMembers);
          assert.ok(id, `Cannot resolve Host registration id: ${idExpression.getText(sourceFile)}`);
          assert.ok(
            permission === null || permission !== undefined,
            `Cannot resolve Host access declaration for ${id}: ${permissionExpression.getText(sourceFile)}`
          );
          const previous = permissions.get(id);
          assert.ok(
            previous === undefined || previous === permission,
            `Host target ${id} has conflicting permissions: ${previous} and ${permission}`
          );
          permissions.set(id, permission);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return permissions;
};

const collectAppHostTargets = async (packageDirectory: string): Promise<ReadonlySet<string>> => {
  const sourceFile = await parseSource(`apps/${packageDirectory}/src/index.tsx`);
  const targets = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && node.text.startsWith("lyra.core.")) {
      targets.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return targets;
};

test("first-party signed manifest permissions cover every consumed Host command and event", async () => {
  assert.equal(FIRST_PARTY_APP_RELEASE_CONTRACTS_V1.length, 9);
  const registeredPermissions = await collectRegisteredHostPermissions();

  for (const [componentId, packageDirectory, manifestPermissions] of FIRST_PARTY_APP_RELEASE_CONTRACTS_V1) {
    const granted = new Set<string>(manifestPermissions);
    const targets = await collectAppHostTargets(packageDirectory);
    assert.ok(targets.size > 0, `${componentId} does not declare any Host targets`);

    for (const target of [...targets].sort()) {
      assert.ok(
        registeredPermissions.has(target),
        `${componentId} consumes an unregistered Host target: ${target}`
      );
      const requiredPermission = registeredPermissions.get(target);
      if (requiredPermission === null) {
        continue;
      }
      assert.ok(
        requiredPermission !== undefined,
        `${componentId} consumes an unregistered Host target: ${target}`
      );
      assert.ok(
        granted.has(requiredPermission),
        `${componentId} consumes ${target}, which requires missing signed permission ${requiredPermission}`
      );
    }
  }
});
