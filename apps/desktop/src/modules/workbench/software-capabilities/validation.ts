import type {
  LoginManagerAuthMethodKind
} from "../../../shared/desktop-bridge";
import {
  LOGIN_MANAGER_AUTH_METHOD_KINDS
} from "./manifest";

export const toRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false
    ? value as Record<string, unknown>
    : {};

export const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const requiredString = (input: unknown, field: string): string => {
  const value = nonEmptyString(toRecord(input)[field]);
  if (value === null) {
    throw new Error(`${field} is required`);
  }
  return value;
};

export const optionalString = (input: unknown, field: string): string | undefined =>
  nonEmptyString(toRecord(input)[field]) ?? undefined;

export const optionalBoolean = (input: unknown, field: string): boolean | undefined => {
  const value = toRecord(input)[field];
  return typeof value === "boolean" ? value : undefined;
};

export const optionalNumber = (input: unknown, field: string): number | undefined => {
  const value = toRecord(input)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const optionalLoginAuthMethodKind = (
  input: unknown,
  field: string
): LoginManagerAuthMethodKind | undefined => {
  const value = optionalString(input, field);
  return LOGIN_MANAGER_AUTH_METHOD_KINDS.includes(value as LoginManagerAuthMethodKind)
    ? value as LoginManagerAuthMethodKind
    : undefined;
};

export const requirePermissionGranted = (input: unknown, actionId: string): void => {
  if (optionalBoolean(input, "permissionGranted") !== true) {
    throw new Error(`${actionId} requires runtime permission before it can run.`);
  }
};

export const parentDirectoryPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/gu, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
};

export const baseName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/gu, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
};

export const validateInputSchema = (
  input: unknown,
  schema: unknown
): readonly string[] => {
  if (schema === undefined) return [];
  const schemaRecord = toRecord(schema);
  if (schemaRecord.type !== "object") return [];
  const inputRecord = toRecord(input);
  const errors: string[] = [];
  const required = Array.isArray(schemaRecord.required)
    ? schemaRecord.required.filter((field): field is string => typeof field === "string")
    : [];
  for (const field of required) {
    if (inputRecord[field] === undefined) {
      errors.push(`${field} is required`);
    }
  }
  const properties = toRecord(schemaRecord.properties);
  for (const [field, propertySchema] of Object.entries(properties)) {
    if (inputRecord[field] === undefined) continue;
    const property = toRecord(propertySchema);
    const value = inputRecord[field];
    if (
      typeof property.type === "string" &&
      property.type !== "object" &&
      property.type !== "array" &&
      typeof value !== property.type
    ) {
      errors.push(`${field} must be ${property.type}`);
    }
    if (Array.isArray(property.enum) && property.enum.includes(value) === false) {
      errors.push(`${field} must be one of ${property.enum.join(", ")}`);
    }
  }
  return errors;
};
