import { SURFACE_TARGET_LOOKUP } from "./surface-target";

export type NativeSelectRequest = {
  readonly optionLabel?: string;
  readonly selectValue?: string;
  readonly selectValues?: readonly string[];
  readonly optionQuery?: string;
  readonly optionOffset?: number;
};

export type NativeSelectInspection = {
  readonly options: readonly {label:string;value:string;selected:boolean;disabled:boolean}[];
  readonly total: number;
  readonly matched: number;
  readonly offset: number;
  readonly nextOffset?: number;
  readonly multiple: boolean;
};

export type NativeSelectResult = {
  readonly native: boolean;
  readonly ok?: boolean;
  readonly message?: string;
  readonly changed?: boolean;
  readonly values?: string[];
  readonly inspection?: NativeSelectInspection;
};

// Native popup options are not ordinary page hit-test targets. Use the HTML
// select contract, as browser automation does, without opening an OS popup.
// Validate every requested option before changing any selection.
export const nativeSelectScript = (ref: string, request: NativeSelectRequest): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const node = findSurfaceTarget(${JSON.stringify(ref)});
  if (!node || node.tagName !== 'SELECT') return { native: false };
  const fail = message => ({native:true, ok:false, message});
  if (node.matches(':disabled') || node.closest('[inert],[aria-disabled=true]')) return fail('Select is disabled');
  const request = ${JSON.stringify(request)};
  const choices = ['optionLabel','selectValue','selectValues'].filter(key => request[key] !== undefined);
  if (!choices.length) {
    const query = String(request.optionQuery ?? '').toLocaleLowerCase();
    const offset = request.optionOffset ?? 0;
    const matched = Array.from(node.options).filter(option => (option.label+' '+option.value).toLocaleLowerCase().includes(query));
    const options = [];
    let chars = 0;
    for (const option of matched.slice(offset,offset+20)) {
      const item = {label:option.label,value:option.value,selected:option.selected,disabled:option.disabled || !!option.parentElement?.disabled};
      const size = JSON.stringify(item).length;
      if (chars+size>5000) {
        if (!options.length) return fail('This option is too large to enumerate; narrow optionQuery or select an exact known label/value');
        break;
      }
      options.push(item);chars+=size;
    }
    const end=offset+options.length;
    return {native:true,ok:true,inspection:{options,total:node.options.length,matched:matched.length,offset,
      ...(end<matched.length?{nextOffset:end}:{}),multiple:node.multiple}};
  }
  if (choices.length !== 1)
    return fail('Supply exactly one of optionLabel, selectValue or selectValues');
  const wants = request.selectValues ?? [request.selectValue ?? request.optionLabel];
  if (!node.multiple && wants.length !== 1) return fail('Single select requires exactly one value');
  node.focus({preventScroll:true});
  if (!node.isConnected) return fail('Select was replaced during focus');
  const selected = [];
  for (const want of wants) {
    const matches = Array.from(node.options).filter(option => request.optionLabel !== undefined ? option.label === want : option.value === want);
    if (matches.length !== 1) return fail(matches.length ? 'Ambiguous option; use a unique value' : 'Option not found');
    const option = matches[0];
    if (option.disabled || option.parentElement?.disabled) return fail('Requested option is disabled');
    selected.push(option);
  }
  const changed = Array.from(node.options).some(option => option.selected !== selected.includes(option));
  if (changed) {
    for (const option of node.options) option.selected = selected.includes(option);
    if (!selected.length) node.selectedIndex = -1;
    const Event = node.ownerDocument.defaultView.Event;
    node.dispatchEvent(new Event('input', {bubbles:true,composed:true}));
    node.dispatchEvent(new Event('change', {bubbles:true}));
  }
  return {native:true, ok:true, changed, values:selected.map(option => option.value)};
})()`;
