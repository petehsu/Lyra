import { groupSplitFields, type InputField } from "./input-field-group";
export type { InputField } from "./input-field-group";

export type InputWrite = {
  readonly targetRef: string;
  readonly text: string;
  readonly clear: boolean;
};

export type InputAssignment = {
  readonly targetRef?: string;
  readonly elementId?: number;
  readonly text: string;
  readonly clear?: boolean;
};

export type InputPlan =
  | { readonly ok: true; readonly writes: readonly InputWrite[] }
  | {
    readonly ok: false;
    readonly kind: "notAnInput" | "inputChoice" | "fieldNotReady" | "noEditableTarget" | "missingTarget";
    readonly message: string;
  };

export const inputFieldFromElement = (element: {
  readonly id: number;
  readonly targetRef?: string;
  readonly tagName: string;
  readonly role: string;
  readonly label: string;
  readonly editable?: boolean;
  readonly actionHint?: string;
  readonly disabled?: boolean;
  readonly textSnippet?: string;
  readonly frameRef?: string;
  readonly semantics?: { readonly constraints?: Readonly<Record<string,string>>; readonly context?: readonly string[] };
  readonly bounds: InputField["bounds"];
}): InputField => ({
  elementId: element.id,
  targetRef: element.targetRef ?? "",
  tagName: element.tagName,
  role: element.role,
  label: element.label,
  editable: element.editable === true || element.actionHint === "type",
  disabled: element.disabled === true,
  textSnippet: element.textSnippet ?? "",
  bounds: element.bounds,
  frameRef: element.frameRef,
  maxLength: element.semantics?.constraints?.maxlength === undefined ? undefined : Number(element.semantics.constraints.maxlength),
  groupKey: element.semantics?.context?.find(context => /^(form|group|dialog):/.test(context))
});

const isComposer = (field: InputField): boolean => field.tagName.toLowerCase() === "textarea";

const isWritable = (field: InputField): boolean =>
  field.editable === true && field.disabled !== true && field.targetRef.length > 0;

const fieldLine = (field: InputField): string => {
  const value = field.textSnippet.length === 0 ? ` = ""` : ` = ${field.textSnippet}`;
  return `${field.targetRef} 输入框 "${field.label}"${value}`;
};

const listLines = (fields: readonly InputField[]): string =>
  fields.filter(isWritable).map(fieldLine).join("\n");

const findField = (
  fields: readonly InputField[],
  assignment: { readonly targetRef?: string; readonly elementId?: number }
): InputField | undefined => {
  if (assignment.targetRef !== undefined && assignment.targetRef.length > 0) {
    return fields.find((field) => field.targetRef === assignment.targetRef);
  }
  if (assignment.elementId !== undefined) {
    return fields.find((field) => field.elementId === assignment.elementId);
  }
  return undefined;
};

// The schema promises clear=false by default. Guessing replacement from the
// tag/name/text prefix erased rich editor lists and selected-text edits.
const shouldClear = (_field: InputField, _text: string, clear: boolean | undefined): boolean => clear === true;

const splitText = (text: string): string => text.replace(/[\s-]+/gu, "");

const writeOne = (field: InputField, text: string, clear: boolean | undefined): InputWrite => ({
  targetRef: field.targetRef,
  text,
  clear: shouldClear(field, text, clear)
});

const refuseField = (field: InputField): InputPlan => {
  if (field.disabled) {
    return { ok: false, kind: "fieldNotReady", message: `这一格还不能写。\n${fieldLine(field)}` };
  }
  return { ok: false, kind: "notAnInput", message: `这个编号不能输入。\n${fieldLine({ ...field, editable: true })}` };
};

const planSplit = (
  fields: readonly InputField[],
  field: InputField,
  text: string,
  clear: boolean | undefined
): InputPlan | null => {
  const pieces = splitText(text);
  if (pieces.length <= 1) return null;
  const group = groupSplitFields(fields).find((candidate) => candidate.some((box) => box.targetRef === field.targetRef));
  if (group === undefined) return null;
  const start = group.findIndex((box) => box.targetRef === field.targetRef);
  const slice = group.slice(start);
  if (slice.length !== pieces.length) {
    return {
      ok: false,
      kind: "inputChoice",
      message: `这段文字对不上这组输入框。\n${slice.map(fieldLine).join("\n")}`
    };
  }
  return {
    ok: true,
    writes: slice.map((box, index) => writeOne(box, pieces[index] ?? "", clear ?? true))
  };
};

export const planInputWrites = (
  fields: readonly InputField[],
  request: {
    readonly targetRef?: string;
    readonly elementId?: number;
    readonly text: string;
    readonly clear?: boolean;
    readonly assignments?: readonly InputAssignment[];
  }
): InputPlan => {
  const assignments = request.assignments ?? [];
  if (assignments.length > 0) {
    const writes: InputWrite[] = [];
    for (const assignment of assignments) {
      const field = findField(fields, assignment);
      if (field === undefined) {
        return { ok: false, kind: "missingTarget", message: "这个编号不在当前地图上。" };
      }
      if (!isWritable(field)) {
        return field.disabled
          ? { ok: false, kind: "fieldNotReady", message: `这一格还不能写。\n${fieldLine(field)}` }
          : { ok: false, kind: "notAnInput", message: `这个编号不能输入。\n${listLines(fields)}` };
      }
      const split = planSplit(fields, field, assignment.text, assignment.clear ?? request.clear);
      if (split && !split.ok) return split;
      const next = split?.ok ? split.writes : [writeOne(field, assignment.text, assignment.clear ?? request.clear)];
      if (next.some(write => writes.some(previous => previous.targetRef === write.targetRef))) {
        return {ok:false,kind:"inputChoice",message:"Input assignments overlap. Specify each field once; no text was written."};
      }
      writes.push(...next);
    }
    return { ok: true, writes };
  }

  const addressed = request.targetRef !== undefined || request.elementId !== undefined;
  if (addressed) {
    const field = findField(fields, request);
    if (field === undefined) {
      return { ok: false, kind: "missingTarget", message: "这个编号不在当前地图上。" };
    }
    if (!isWritable(field)) {
      if (field.disabled) return refuseField(field);
      return { ok: false, kind: "notAnInput", message: `这个编号不能输入。\n${listLines(fields)}` };
    }
    return planSplit(fields, field, request.text, request.clear) ?? {
      ok: true,
      writes: [writeOne(field, request.text, request.clear)]
    };
  }

  const writable = fields.filter(isWritable);
  if (writable.length === 0) {
    return { ok: false, kind: "noEditableTarget", message: "当前地图上没有输入框。" };
  }
  const opened = writable.filter((field) => !isComposer(field));
  if (opened.length === 1 && writable.some(isComposer)) {
    return planSplit(fields, opened[0]!, request.text, request.clear) ?? {
      ok: true,
      writes: [writeOne(opened[0]!, request.text, request.clear)]
    };
  }
  if (writable.length === 1) {
    return planSplit(fields, writable[0]!, request.text, request.clear) ?? {
      ok: true,
      writes: [writeOne(writable[0]!, request.text, request.clear)]
    };
  }
  const matched = groupSplitFields(fields).find((group) => group.length === splitText(request.text).length);
  if (matched !== undefined && matched[0] !== undefined) {
    return planSplit(fields, matched[0], request.text, request.clear) ?? {
      ok: false,
      kind: "inputChoice",
      message: `有多行输入，需要指定编号。\n${listLines(writable)}`
    };
  }
  return {
    ok: false,
    kind: "inputChoice",
    message: `有多行输入，需要指定编号。\n${listLines(writable)}`
  };
};
