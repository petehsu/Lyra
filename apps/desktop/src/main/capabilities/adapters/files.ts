import fs from "node:fs/promises";
import path from "node:path";

import type { LyraAppManifest } from "@lyra/capability-protocol";
import type { FilesNativeBindings } from "../../files/types";
import type { LyraRuntimeClient } from "../../runtime-client";
import type { CapabilityRegistry } from "../registry";
import {
  previewFilesystemApplyPatch,
  previewFilesystemEdit,
  previewFilesystemMultiEdit,
  runFilesystemApplyPatch,
  type FilePreparedMutationResult,
  runFilesystemGlob,
  runFilesystemReadRange,
  runFilesystemSearch
} from "./files-code-tools";

const FILE_MANAGER_APP_ID = "file-manager";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const requireString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
};

const optionalString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const optionalNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const requireNumber = (record: Record<string, unknown>, key: string): number => {
  const value = optionalNumber(record, key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const optionalBoolean = (record: Record<string, unknown>, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const requireStringArray = (record: Record<string, unknown>, key: string): readonly string[] => {
  const value = record[key];
  if (Array.isArray(value) === false) {
    throw new Error(`${key} is required`);
  }
  const entries = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error(`${key} is required`);
  }
  return entries;
};

const resolveScopedPath = (targetPath: string, workspaceRoot?: string): string => {
  if (path.isAbsolute(targetPath) || workspaceRoot === undefined) {
    return targetPath;
  }
  return path.resolve(workspaceRoot, targetPath);
};

const ensureWithinWorkspaceRoot = (
  resolvedPath: string,
  workspaceRoot?: string
): string => {
  if (workspaceRoot === undefined) {
    return resolvedPath;
  }
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
  const normalizedTargetPath = path.resolve(resolvedPath);
  const relative = path.relative(normalizedWorkspaceRoot, normalizedTargetPath);
  if (
    relative === ""
    || (relative.startsWith("..") === false && path.isAbsolute(relative) === false)
  ) {
    return normalizedTargetPath;
  }
  throw new Error("path must stay within the active workspace root");
};

const resolveScopedWorkspacePath = (
  targetPath: string,
  workspaceRoot?: string
): string =>
  ensureWithinWorkspaceRoot(resolveScopedPath(targetPath, workspaceRoot), workspaceRoot);

const clipPreview = (value: string, maxChars = 4000): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n…`;

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const buildPreparedMutationError = (result: Extract<FilePreparedMutationResult, { readonly ok: false }>): Error => {
  const error = new Error(result.message);
  (error as Error & { code?: string }).code = result.kind;
  return error;
};

export const registerFilesystemCapabilities = (
  registry: CapabilityRegistry,
  bindings: FilesNativeBindings,
  storageRoot: string,
  runtimeClient: LyraRuntimeClient,
  codeIntelStorageRoot: string
): LyraAppManifest => {
  registry.register(
    {
      id: "filesystem.list",
      domain: "filesystem",
      kind: "resource",
      title: "List Filesystem Entries",
      appId: FILE_MANAGER_APP_ID,
      operation: "list",
      description: "List directory contents or read the file manager home snapshot.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const targetPath = optionalString(payload, "path");
      const workspaceRoot = request.context?.workspaceRoot;
      if (targetPath === undefined) {
        return workspaceRoot === undefined
          ? bindings.readHome({ storageRoot })
          : bindings.readDirectory({ path: workspaceRoot });
      }
      return bindings.readDirectory({
        path: resolveScopedPath(targetPath, workspaceRoot)
      });
    }
  );

  registry.register(
    {
      id: "filesystem.glob",
      domain: "filesystem",
      kind: "resource",
      title: "Find Files By Pattern",
      appId: FILE_MANAGER_APP_ID,
      operation: "glob",
      description: "Find candidate files or directories by glob pattern inside the active workspace root.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["pattern"],
        properties: {
          pattern: { type: "string" },
          root: { type: "string" },
          limit: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const workspaceRoot = request.context?.workspaceRoot ?? process.cwd();
      const limit = optionalNumber(payload, "limit");
      return await runFilesystemGlob({
        pattern: requireString(payload, "pattern"),
        rootPath: resolveScopedWorkspacePath(
          optionalString(payload, "root") ?? workspaceRoot,
          workspaceRoot
        ),
        ...(limit === undefined ? {} : { limit })
      });
    }
  );

  registry.register(
    {
      id: "filesystem.search",
      domain: "filesystem",
      kind: "resource",
      title: "Search Text In Files",
      appId: FILE_MANAGER_APP_ID,
      operation: "search",
      description: "Search text across one file or a directory tree and return structured line matches.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["pattern"],
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          glob: { type: "string" },
          limit: { type: "number" },
          caseSensitive: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const workspaceRoot = request.context?.workspaceRoot ?? process.cwd();
      const glob = optionalString(payload, "glob");
      const limit = optionalNumber(payload, "limit");
      const caseSensitive = optionalBoolean(payload, "caseSensitive");
      const pattern = requireString(payload, "pattern");
      const path = resolveScopedWorkspacePath(
        optionalString(payload, "path") ?? workspaceRoot,
        workspaceRoot
      );
      try {
        const indexed = await runtimeClient.request<{
          readonly truncated: boolean;
          readonly matches: readonly {
            readonly path: string;
            readonly relativePath: string;
            readonly line: number;
            readonly excerpt: string;
          }[];
        }>("code.search.text", {
          storageRoot: codeIntelStorageRoot,
          query: pattern,
          path,
          ...(glob === undefined ? {} : { glob }),
          ...(limit === undefined ? {} : { limit }),
          ...(caseSensitive === undefined ? {} : { caseSensitive }),
          ...(request.context?.projectRoot === undefined
            ? {}
            : { projectRoot: request.context.projectRoot })
        });
        return {
          rootPath: path,
          pattern,
          caseSensitive: caseSensitive === true,
          truncated: indexed.truncated,
          matches: indexed.matches
        };
      } catch {
        return await runFilesystemSearch(bindings, {
          pattern,
          path,
          ...(glob === undefined ? {} : { glob }),
          ...(limit === undefined ? {} : { limit }),
          ...(caseSensitive === undefined ? {} : { caseSensitive })
        });
      }
    }
  );

  registry.register(
    {
      id: "filesystem.read_range",
      domain: "filesystem",
      kind: "resource",
      title: "Read File Range",
      appId: FILE_MANAGER_APP_ID,
      operation: "read_range",
      description: "Read only a selected line range from a text file.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["path", "startLine", "endLine"],
        properties: {
          path: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      return runFilesystemReadRange(bindings, {
        path: resolveScopedWorkspacePath(
          requireString(payload, "path"),
          request.context?.workspaceRoot
        ),
        startLine: requireNumber(payload, "startLine"),
        endLine: requireNumber(payload, "endLine")
      });
    }
  );

  registry.register(
    {
      id: "filesystem.create_file",
      domain: "filesystem",
      kind: "action",
      title: "Create File",
      appId: FILE_MANAGER_APP_ID,
      operation: "create_file",
      description: "Create a new file inside a parent directory, optionally with initial text content.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["parentPath", "name"],
        properties: {
          parentPath: { type: "string" },
          name: { type: "string" },
          content: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "utf8-bom"] }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    {
      prepareApproval: async (request) => {
        const payload = asRecord(request.payload);
        const parentPath = resolveScopedPath(
          requireString(payload, "parentPath"),
          request.context?.workspaceRoot
        );
        const name = requireString(payload, "name");
        const filePath = path.join(parentPath, name);
        const content = typeof payload.content === "string" ? payload.content : "";
        const encoding = optionalString(payload, "encoding");
        return {
          title: "Create File",
          description: `Create ${filePath}${content.length > 0 ? " with initial content" : ""}.`,
          canAlwaysAllow: true,
          ...(request.context?.projectRoot === undefined ? {} : { projectRoot: request.context.projectRoot }),
          preview: content.length > 0
            ? {
                kind: "file-create" as const,
                filePath,
                draftPreview: clipPreview(content)
              }
            : {
                kind: "file-create" as const,
                filePath
              },
          commit: async () => {
            const createResult = bindings.createFile({
              parentPath,
              name
            });
            if (content.length === 0) {
              return createResult;
            }
            const writeResult = bindings.writeTextFile({
              path: filePath,
              content,
              ...(encoding === undefined ? {} : { encoding: encoding as "utf8" | "utf8-bom" })
            });
            return {
              ...writeResult,
              baselineContent: "",
              draftPreview: clipPreview(content),
              firstChangedLine: 1
            };
          }
        };
      },
      invoke: async (request) => {
        const payload = asRecord(request.payload);
        return bindings.createFile({
          parentPath: resolveScopedPath(
            requireString(payload, "parentPath"),
            request.context?.workspaceRoot
          ),
          name: requireString(payload, "name")
        });
      }
    }
  );

  registry.register(
    {
      id: "filesystem.create_folder",
      domain: "filesystem",
      kind: "action",
      title: "Create Folder",
      appId: FILE_MANAGER_APP_ID,
      operation: "create_folder",
      description: "Create a new directory inside a parent path.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["parentPath", "name"],
        properties: {
          parentPath: { type: "string" },
          name: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    {
      prepareApproval: async (request) => {
        const payload = asRecord(request.payload);
        const parentPath = resolveScopedPath(
          requireString(payload, "parentPath"),
          request.context?.workspaceRoot
        );
        const name = requireString(payload, "name");
        const folderPath = path.join(parentPath, name);
        return {
          title: "Create Folder",
          description: `Create directory ${folderPath}.`,
          canAlwaysAllow: true,
          ...(request.context?.projectRoot === undefined ? {} : { projectRoot: request.context.projectRoot }),
          preview: {
            kind: "folder-create" as const,
            path: folderPath
          },
          commit: async () => bindings.createFolder({
            parentPath,
            name
          })
        };
      },
      invoke: async (request) => {
        const payload = asRecord(request.payload);
        return bindings.createFolder({
          parentPath: resolveScopedPath(
            requireString(payload, "parentPath"),
            request.context?.workspaceRoot
          ),
          name: requireString(payload, "name")
        });
      }
    }
  );

  registry.register(
    {
      id: "filesystem.read",
      domain: "filesystem",
      kind: "resource",
      title: "Read Text File",
      appId: FILE_MANAGER_APP_ID,
      operation: "read",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      return bindings.readTextFile({
        path: resolveScopedPath(
          requireString(payload, "path"),
          request.context?.workspaceRoot
        )
      });
    }
  );

  registry.register(
    {
      id: "filesystem.edit",
      domain: "filesystem",
      kind: "action",
      title: "Edit File By Exact Replacement",
      appId: FILE_MANAGER_APP_ID,
      operation: "edit",
      description: "Edit an existing text file by replacing an exact text block with new text.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["path", "oldText", "newText"],
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          replaceAll: { type: "boolean" },
          expectedRevision: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    {
      prepareApproval: async (request) => {
        const payload = asRecord(request.payload);
        const replaceAll = optionalBoolean(payload, "replaceAll");
        const expectedRevision = optionalString(payload, "expectedRevision");
        const preview = previewFilesystemEdit(bindings, {
          path: resolveScopedWorkspacePath(
            requireString(payload, "path"),
            request.context?.workspaceRoot
          ),
          oldText: requireString(payload, "oldText"),
          newText: typeof payload.newText === "string" ? payload.newText : String(payload.newText ?? ""),
          ...(replaceAll === undefined ? {} : { replaceAll }),
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });
        if (preview.ok === false) {
          throw buildPreparedMutationError(preview);
        }
        return {
          title: "Edit File",
          description: `Preview edits for ${preview.path}.`,
          canAlwaysAllow: true,
          ...(request.context?.projectRoot === undefined ? {} : { projectRoot: request.context.projectRoot }),
          preview: {
            kind: "file-edit" as const,
            filePath: preview.path,
            baselineContent: preview.baselineContent,
            draftPreview: preview.draftPreview,
            patchSummary: preview.patchSummary,
            firstChangedLine: preview.firstChangedLine,
            addedLines: preview.addedLines,
            removedLines: preview.removedLines,
            ...(preview.expectedRevision === undefined ? {} : { expectedRevision: preview.expectedRevision })
          },
          commit: async () => bindings.writeTextFile({
            path: preview.path,
            content: preview.nextContent,
            expectedRevision: preview.expectedRevision ?? preview.revision,
            encoding: preview.encoding
          })
        };
      }
    }
  );

  registry.register(
    {
      id: "filesystem.multi_edit",
      domain: "filesystem",
      kind: "action",
      title: "Apply Multiple Exact Replacements",
      appId: FILE_MANAGER_APP_ID,
      operation: "multi_edit",
      description: "Apply multiple exact text replacements to one existing file.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["path", "edits"],
        properties: {
          path: { type: "string" },
          edits: {
            type: "array",
            items: {
              type: "object",
              required: ["oldText", "newText"],
              properties: {
                oldText: { type: "string" },
                newText: { type: "string" },
                replaceAll: { type: "boolean" }
              },
              additionalProperties: false
            },
            minItems: 1
          },
          expectedRevision: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    {
      prepareApproval: async (request) => {
        const payload = asRecord(request.payload);
        const editsValue = payload.edits;
        const expectedRevision = optionalString(payload, "expectedRevision");
        if (Array.isArray(editsValue) === false) {
          throw new Error("edits is required");
        }
        const preview = previewFilesystemMultiEdit(bindings, {
          path: resolveScopedWorkspacePath(
            requireString(payload, "path"),
            request.context?.workspaceRoot
          ),
          edits: editsValue.map((entry) => {
            const record = asRecord(entry);
            const replaceAll = optionalBoolean(record, "replaceAll");
            return {
              oldText: requireString(record, "oldText"),
              newText: typeof record.newText === "string" ? record.newText : String(record.newText ?? ""),
              ...(replaceAll === undefined ? {} : { replaceAll })
            };
          }),
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });
        if (preview.ok === false) {
          throw buildPreparedMutationError(preview);
        }
        return {
          title: "Apply Multiple Edits",
          description: `Preview ${preview.patchSummary.toLowerCase()} for ${preview.path}.`,
          canAlwaysAllow: true,
          ...(request.context?.projectRoot === undefined ? {} : { projectRoot: request.context.projectRoot }),
          preview: {
            kind: "file-edit" as const,
            filePath: preview.path,
            baselineContent: preview.baselineContent,
            draftPreview: preview.draftPreview,
            patchSummary: preview.patchSummary,
            firstChangedLine: preview.firstChangedLine,
            addedLines: preview.addedLines,
            removedLines: preview.removedLines,
            ...(preview.expectedRevision === undefined ? {} : { expectedRevision: preview.expectedRevision })
          },
          commit: async () => bindings.writeTextFile({
            path: preview.path,
            content: preview.nextContent,
            expectedRevision: preview.expectedRevision ?? preview.revision,
            encoding: preview.encoding
          })
        };
      }
    }
  );

  registry.register(
    {
      id: "filesystem.apply_patch",
      domain: "filesystem",
      kind: "action",
      title: "Apply Text Patch",
      appId: FILE_MANAGER_APP_ID,
      operation: "apply_patch",
      description: "Apply a single-file text patch to an existing file using hunk-based edit semantics.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["path", "patch"],
        properties: {
          path: { type: "string" },
          patch: { type: "string" },
          expectedRevision: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    {
      prepareApproval: async (request) => {
        const payload = asRecord(request.payload);
        const expectedRevision = optionalString(payload, "expectedRevision");
        const preview = previewFilesystemApplyPatch(bindings, {
          path: resolveScopedWorkspacePath(
            requireString(payload, "path"),
            request.context?.workspaceRoot
          ),
          patch: requireString(payload, "patch"),
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });
        if (preview.ok === false) {
          throw buildPreparedMutationError(preview);
        }
        return {
          title: "Apply Patch",
          description: `Preview ${preview.patchSummary.toLowerCase()} for ${preview.path}.`,
          canAlwaysAllow: true,
          ...(request.context?.projectRoot === undefined ? {} : { projectRoot: request.context.projectRoot }),
          preview: {
            kind: "file-edit" as const,
            filePath: preview.path,
            baselineContent: preview.baselineContent,
            draftPreview: preview.draftPreview,
            patchSummary: preview.patchSummary,
            firstChangedLine: preview.firstChangedLine,
            addedLines: preview.addedLines,
            removedLines: preview.removedLines,
            ...(preview.expectedRevision === undefined ? {} : { expectedRevision: preview.expectedRevision })
          },
          commit: async () => runFilesystemApplyPatch(bindings, {
            path: preview.path,
            patch: requireString(payload, "patch"),
            ...(preview.expectedRevision === undefined ? {} : { expectedRevision: preview.expectedRevision })
          })
        };
      }
    }
  );

  registry.register(
    {
      id: "filesystem.write",
      domain: "filesystem",
      kind: "action",
      title: "Write Text File",
      appId: FILE_MANAGER_APP_ID,
      operation: "write",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          expectedRevision: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "utf8-bom"] }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    {
      prepareApproval: async (request) => {
        const payload = asRecord(request.payload);
        const filePath = resolveScopedWorkspacePath(
          requireString(payload, "path"),
          request.context?.workspaceRoot
        );
        const content = typeof payload.content === "string" ? payload.content : String(payload.content ?? "");
        const expectedRevision = optionalString(payload, "expectedRevision");
        const encoding = optionalString(payload, "encoding");
        const exists = await pathExists(filePath);

        if (exists) {
          const readResult = bindings.readTextFile({ path: filePath });
          if (readResult.kind !== "text") {
            throw new Error(readResult.reason);
          }
          if (readResult.readOnly) {
            throw new Error("file is read-only");
          }
          const addedLines = Math.max(0, content.split(/\r?\n/).length - readResult.content.split(/\r?\n/).length);
          const removedLines = Math.max(0, readResult.content.split(/\r?\n/).length - content.split(/\r?\n/).length);
          return {
            title: "Write File",
            description: `Preview a full rewrite for ${filePath}.`,
            canAlwaysAllow: true,
            ...(request.context?.projectRoot === undefined ? {} : { projectRoot: request.context.projectRoot }),
            preview: {
              kind: "file-edit" as const,
              filePath,
              baselineContent: readResult.content,
              draftPreview: clipPreview(content),
              patchSummary: "Full file rewrite",
              firstChangedLine: 1,
              addedLines,
              removedLines,
              ...(expectedRevision === undefined ? {} : { expectedRevision })
            },
            commit: async () => bindings.writeTextFile({
              path: filePath,
              content,
              ...(expectedRevision === undefined ? {} : { expectedRevision }),
              ...(encoding === undefined ? {} : { encoding: encoding as "utf8" | "utf8-bom" })
            })
          };
        }

        return {
          title: "Create File By Write",
          description: `Create ${filePath} from scratch.`,
          canAlwaysAllow: true,
          ...(request.context?.projectRoot === undefined ? {} : { projectRoot: request.context.projectRoot }),
          preview: {
            kind: "file-create" as const,
            filePath,
            draftPreview: clipPreview(content)
          },
          commit: async () => bindings.writeTextFile({
            path: filePath,
            content,
            ...(expectedRevision === undefined ? {} : { expectedRevision }),
            ...(encoding === undefined ? {} : { encoding: encoding as "utf8" | "utf8-bom" })
          })
        };
      }
    }
  );

  registry.register(
    {
      id: "filesystem.stat",
      domain: "filesystem",
      kind: "resource",
      title: "Stat File",
      appId: FILE_MANAGER_APP_ID,
      operation: "stat",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      return bindings.statFile({
        path: resolveScopedPath(
          requireString(payload, "path"),
          request.context?.workspaceRoot
        )
      });
    }
  );

  registry.register(
    {
      id: "filesystem.trash.move",
      domain: "filesystem",
      kind: "action",
      title: "Move Items To Trash",
      appId: FILE_MANAGER_APP_ID,
      operation: "trash.move",
      description: "Move one or more filesystem paths into the trash.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["paths"],
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            minItems: 1
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const workspaceRoot = request.context?.workspaceRoot;
      const paths = requireStringArray(payload, "paths").map((entry) =>
        resolveScopedPath(entry, workspaceRoot)
      );
      bindings.moveToTrash({
        storageRoot,
        paths
      });
      return {
        moved: true,
        pathCount: paths.length
      };
    }
  );

  registry.register(
    {
      id: "filesystem.trash.restore",
      domain: "filesystem",
      kind: "action",
      title: "Restore Trashed Items",
      appId: FILE_MANAGER_APP_ID,
      operation: "trash.restore",
      description: "Restore one or more items from the trash.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["itemIds"],
        properties: {
          itemIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const itemIds = requireStringArray(payload, "itemIds");
      bindings.restoreFromTrash({
        storageRoot,
        itemIds
      });
      return {
        restored: true,
        itemCount: itemIds.length
      };
    }
  );

  registry.register(
    {
      id: "filesystem.trash.empty",
      domain: "filesystem",
      kind: "action",
      title: "Empty Trash",
      appId: FILE_MANAGER_APP_ID,
      operation: "trash.empty",
      description: "Permanently delete all items currently stored in the trash.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async () => {
      bindings.emptyTrash({ storageRoot });
      return {
        emptied: true
      };
    }
  );

  registry.register(
    {
      id: "filesystem.device.mount",
      domain: "filesystem",
      kind: "action",
      title: "Mount Device",
      appId: FILE_MANAGER_APP_ID,
      operation: "device.mount",
      description: "Mount a removable or external device.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "hidden",
      inputSchema: {
        type: "object",
        required: ["devicePath", "kind"],
        properties: {
          devicePath: { type: "string" },
          kind: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      return bindings.mountDevice({
        devicePath: requireString(payload, "devicePath"),
        kind: requireString(payload, "kind") as "system" | "local" | "removable" | "external"
      });
    }
  );

  registry.register(
    {
      id: "filesystem.device.eject",
      domain: "filesystem",
      kind: "action",
      title: "Eject Device",
      appId: FILE_MANAGER_APP_ID,
      operation: "device.eject",
      description: "Eject a mounted removable or external device.",
      permissions: ["filesystem:write"],
      risk: "write",
      approvalMode: "ask",
      aiExposure: "hidden",
      inputSchema: {
        type: "object",
        required: ["mountPath", "kind"],
        properties: {
          mountPath: { type: "string" },
          devicePath: { type: "string" },
          kind: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const devicePath = optionalString(payload, "devicePath");
      return bindings.ejectDevice({
        mountPath: requireString(payload, "mountPath"),
        ...(devicePath === undefined ? {} : { devicePath }),
        kind: requireString(payload, "kind") as "system" | "local" | "removable" | "external"
      });
    }
  );

  return {
    id: FILE_MANAGER_APP_ID,
    title: "File Manager",
    version: "0.1.0",
    source: "builtin",
    permissions: ["filesystem:read", "filesystem:write"],
    capabilities: [
      "filesystem.list",
      "filesystem.glob",
      "filesystem.search",
      "filesystem.read_range",
      "filesystem.create_file",
      "filesystem.create_folder",
      "filesystem.read",
      "filesystem.edit",
      "filesystem.multi_edit",
      "filesystem.apply_patch",
      "filesystem.write",
      "filesystem.stat",
      "filesystem.trash.move",
      "filesystem.trash.restore",
      "filesystem.trash.empty",
      "filesystem.device.mount",
      "filesystem.device.eject"
    ],
    compatibility: {
      minApiVersion: "0.1.0",
      platforms: ["macos", "windows", "linux"]
    },
    contributes: {
      surfaces: ["workspace"]
    }
  };
};
