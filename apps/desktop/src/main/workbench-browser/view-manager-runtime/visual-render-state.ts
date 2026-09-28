import { createHash } from "node:crypto";
import type { VisualMark, VisualCell } from "./visual-scene-types";

/** Rendered facts, not application objects, data-* payloads or interpreted class names. */
export const READ_RENDER_STATE = String.raw`node => {
  const short=(v,n=96)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n);
  const state={};
  for(const name of ['checked','pressed','selected','expanded','current','busy','invalid']) {
    const value=node.getAttribute('aria-'+name); if(value!==null)state[name]=short(value,24);
  }
  if(/^(INPUT|OPTION)$/.test(node.tagName)) {
    if(typeof node.checked==='boolean' && /^(checkbox|radio)$/.test(node.type))state.checked=node.checked;
    if(typeof node.selected==='boolean')state.selected=node.selected;
  }
  const fingerprint=v=>{let h=2166136261;for(let i=0;i<v.length;i++)h=Math.imul(h^v.charCodeAt(i),16777619);return (h>>>0).toString(16)};
  const tokens=n=>[...n.classList].filter(c=>!c.startsWith('__lyra')&&!c.startsWith('data-lyra')).sort().slice(0,12);
  const painted=(n,pseudo)=>{
    const s=getComputedStyle(n,pseudo),b=n.getBoundingClientRect();
    if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||!b.width||!b.height)return null;
    const image=s.backgroundImage==='none'?'':short(s.backgroundImage,160)+(s.backgroundImage.length>160?' [hash:'+fingerprint(s.backgroundImage)+']':'');
    const content=pseudo && !['none','normal','""'].includes(s.content) ? short(s.content,48) : '';
    const text=pseudo||n.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)?'':short([...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent).join(' '),48);
    return {tokens:pseudo?[]:tokens(n),background:s.backgroundColor,...(image?{image}:{}),
      ...(text?{text,color:s.color}:{}),...(content?{content}:{}),
      ...(s.borderTopWidth!=='0px'?{border:s.borderTopColor}:{}),...(s.opacity!=='1'?{opacity:s.opacity}:{}),
      ...(s.borderRadius!=='0px'?{radius:s.borderRadius}:{}),...(pseudo?{pseudo}:{})};
  };
  const layers=[];
  const add=n=>{const base=painted(n);if(!base)return false;layers.push(base);
    for(const pseudo of ['::before','::after']){const s=getComputedStyle(n,pseudo);if(!['none','normal','""'].includes(s.content)){const p=painted(n,pseudo);if(p)layers.push(p);}}return true;};
  add(node);
  // Only bounded painted descendants. Canvas pixels are explicitly not classified here.
  for(const child of [...node.children].slice(0,4)){if(!add(child))continue;for(const n of [...child.children].slice(0,2))add(n);}
  return {attributes:state,layers:layers.slice(0,8)};
}`;

export const renderStateId = (value: unknown) =>
  "s" +
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 10);

type RenderCell = VisualCell & { state: string };
type RenderStructure = {
  namedCells: (VisualCell & { name: string })[];
  namesOmitted: number;
  mark: string;
  rows: number;
  columns: number;
  baseline: string;
  counts: Record<string, number>;
  distinctStates: number;
  countsOmitted: number;
  changedCount?: number;
  changed?: RenderCell[];
  changesOmitted?: number;
  comparison?: string;
  exceptions?: RenderCell[];
  rowRuns?: string[];
  focusedCell?: VisualCell & { state: string | undefined };
  detailRequired?: boolean;
  stateWindow?: RenderCell[];
  positionsOmitted?: number;
  detail?: string;
};

export const summarizeRenderStates = (
  marks: readonly VisualMark[],
  focus?: { region: string; cell?: VisualCell | undefined },
  previous: readonly VisualMark[] = [],
) => {
  const dictionary = new Map<string, unknown>();
  const include = (mark: VisualMark) => {
    if (!mark.renderState) return undefined;
    const id = renderStateId(mark.renderState);
    dictionary.set(id, mark.renderState);
    return id;
  };
  const structures = marks
    .filter((m) => m.grid?.cells)
    .map<RenderStructure>((mark) => {
      const cells = mark.grid!.cells!,
        columns = mark.grid!.xs.length;
      const states = cells.map(
        (cell) => include(cell as VisualMark) ?? "unknown",
      );
      const counts = new Map<string, number>();
      states.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
      const baseline = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
      const rows: string[] = [];
      // Run-length encoding includes every position, including unfamiliar states.
      for (let start = 0; start < states.length; start += columns) {
        const runs: string[] = [];
        let previous = "",
          count = 0;
        for (const id of states.slice(start, start + columns)) {
          if (id === previous) {
            count++;
            continue;
          }
          if (count) runs.push(`${previous}*${count}`);
          previous = id;
          count = 1;
        }
        if (count) runs.push(`${previous}*${count}`);
        rows.push(runs.join(" "));
      }
      const prior = previous.find(
        (p) =>
          p.targetRef === mark.targetRef && p.documentId === mark.documentId,
      )?.grid;
      const comparable =
        prior?.cells &&
        JSON.stringify(prior.xs) === JSON.stringify(mark.grid!.xs) &&
        JSON.stringify(prior.ys) === JSON.stringify(mark.grid!.ys);
      const changes = comparable
        ? states.flatMap((state, i) => {
            const before = prior!.cells![i]?.renderState;
            return before && renderStateId(before) === state
              ? []
              : [
                  {
                    row: Math.floor(i / columns) + 1,
                    column: (i % columns) + 1,
                    state,
                  },
                ];
          })
        : undefined;
      const exceptions = states.flatMap((state, i) =>
        state === baseline
          ? []
          : [
              {
                row: Math.floor(i / columns) + 1,
                column: (i % columns) + 1,
                state,
              },
            ],
      );
      const named = cells.flatMap((cell, i) =>
        cell.name
          ? [
              {
                row: Math.floor(i / columns) + 1,
                column: (i % columns) + 1,
                name: cell.name,
              },
            ]
          : [],
      );
      if (focus?.region === mark.mark && focus.cell)
        named.sort(
          (a, b) =>
            Math.abs(a.row - focus.cell!.row) +
            Math.abs(a.column - focus.cell!.column) -
            (Math.abs(b.row - focus.cell!.row) +
              Math.abs(b.column - focus.cell!.column)),
        );
      return {
        namedCells: named.slice(0, 24),
        namesOmitted: Math.max(0, named.length - 24),
        mark: mark.mark,
        ...(changes
          ? {
              changedCount: changes.length,
              changed: changes.slice(0, 48),
              changesOmitted: Math.max(0, changes.length - 48),
            }
          : { comparison: "baseline" }),
        rows: mark.grid!.ys.length,
        columns,
        baseline,
        counts: Object.fromEntries([...counts].slice(0, 16)),
        distinctStates: counts.size,
        countsOmitted: Math.max(0, counts.size - 16),
        ...(exceptions.length <= 48 ? { exceptions } : { rowRuns: rows }),
        ...(focus?.region === mark.mark && focus.cell
          ? {
              focusedCell: {
                ...focus.cell,
                state:
                  states[
                    (focus.cell.row - 1) * columns + focus.cell.column - 1
                  ],
              },
            }
          : {}),
      };
    });
  const objects = marks.map((mark) => ({
    mark: mark.mark,
    targetRef: mark.targetRef,
    ...(mark.name ? { name: mark.name } : {}),
    ...{ state: include(mark) },
    ...(mark.disabled ? { disabled: true } : {}),
  }));
  let structureBudget = 5000;
  const selectedStructures = [...structures]
    .sort(
      (a, b) =>
        Number(b.mark === focus?.region) - Number(a.mark === focus?.region),
    )
    .slice(0, 8);
  const boundedStructures = selectedStructures.map((s) => {
    if (JSON.stringify(s).length <= structureBudget) {
      structureBudget -= JSON.stringify(s).length;
      return s;
    }
    const m = marks.find((m) => m.mark === s.mark)!;
    const center =
      focus?.region === s.mark && focus.cell
        ? focus.cell
        : { row: Math.ceil(s.rows / 2), column: Math.ceil(s.columns / 2) };
    const window = m.grid!.cells!.flatMap((cell, i) => {
      const row = Math.floor(i / s.columns) + 1,
        column = (i % s.columns) + 1;
      return Math.abs(row - center.row) <= 2 &&
        Math.abs(column - center.column) <= 2
        ? [{ row, column, state: include(cell as VisualMark) ?? "unknown" }]
        : [];
    });
    const {
      rowRuns: _rows,
      exceptions: _exceptions,
      changed: _changed,
      ...summary
    } = s;
    const shown = structureBudget >= 1800 ? window : [];
    structureBudget -= 1800;
    return {
      ...summary,
      detailRequired: true,
      stateWindow: shown,
      positionsOmitted: s.rows * s.columns - shown.length,
      changesOmitted: s.changedCount ?? 0,
      detail:
        "All positions remain addressable. see(representation=structure,region,cell) retrieves rendered state around that cell; this window is not the whole state.",
    };
  });
  const focusedId =
    structures.find((s) => s.focusedCell)?.focusedCell?.state ??
    objects.find((o) => o.mark === focus?.region)?.state;
  const entries = [...dictionary];
  if (focusedId)
    entries.sort(
      ([a], [b]) => Number(b === focusedId) - Number(a === focusedId),
    );
  const legend: [string, unknown][] = [];
  let legendBudget = 6000;
  for (const entry of entries) {
    const size = JSON.stringify(entry).length;
    if (legend.length >= 16 || (size > legendBudget && legend.length > 0))
      continue;
    legend.push(entry);
    legendBudget -= size;
  }
  return {
    objects,
    structures: boundedStructures,
    structuresOmitted: structures.length - boundedStructures.length,
    states: Object.fromEntries(legend),
    stateCount: entries.length,
    statesOmitted: entries.length - legend.length,
    basis:
      "Rendered DOM attributes and painted layers; CSS class tokens are untrusted evidence, not inferred rules, occupancy or object identity. All positions remain indexed, with explicit detailRequired windows when the state is too large; state descriptions sample bounded painted layers and do not establish full semantic equality. For a missing state description use see(representation=structure,region,cell). Canvas internals remain unknown; inspect pixels when rendered facts are insufficient.",
  };
};
