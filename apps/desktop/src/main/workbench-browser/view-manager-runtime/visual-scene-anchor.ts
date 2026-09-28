import type {
  VisualAnchor,
  VisualCell,
  VisualScene,
  VisualStep,
} from "./visual-scene-types";

const directions = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  upLeft: [-1, -1],
  upRight: [1, -1],
  downLeft: [-1, 1],
  downRight: [1, 1],
} as const;

export const visualInputEndpoint = (step: VisualStep): VisualStep => {
  if (step.interaction !== "drag")
    return {
      interaction: step.interaction,
      ...(step.mark ? { mark: step.mark } : {}),
      ...(step.cell ? { cell: step.cell } : {}),
      ...(step.position ? { position: step.position } : {}),
    };
  const mark = step.toMark ?? step.mark,
    position = step.toPosition ?? (step.mark ? step.path?.at(-1) : undefined);
  return {
    interaction: "drag",
    ...(mark ? { mark } : {}),
    ...(step.toCell ? { cell: step.toCell } : {}),
    ...(position ? { position } : {}),
  };
};

/** Resolve explicit spatial intent against an observation, never an inferred next action. */
export const resolveVisualAnchors = (
  steps: readonly VisualStep[],
  scene: VisualScene,
): VisualStep[] => {
  let previous = scene.lastInput;
  return steps.map((step) => {
    const resolve = (id: string | undefined, at: VisualAnchor) => {
      if (!at || !id)
        throw new Error("Spatial anchor requires a published mark");
      const mark = scene.marks.find((m) => m.mark === id.toLowerCase());
      if (!mark) throw new Error("Spatial anchor mark was not observed");
      const distance = at.steps ?? 1;
      if (
        !Number.isInteger(distance) ||
        distance < 1 ||
        distance > 1600 ||
        (at.direction && !directions[at.direction]) ||
        (at.steps !== undefined && !at.direction)
      )
        throw new Error("Invalid spatial direction or steps");
      const last =
        previous?.mark?.toLowerCase() === mark.mark ? previous : undefined;
      if (!mark.grid) {
        if (at.direction || typeof at.anchor === "object")
          throw new Error(
            "Directional cell steps require an observed grid; no arbitrary pixel distance is assumed",
          );
        if (at.anchor === "center") return { position: { x: 0.5, y: 0.5 } };
        if (at.anchor === "lastInput" && last && !last.cell)
          return { position: last.position ?? { x: 0.5, y: 0.5 } };
        throw new Error(
          "No delivered input anchor for this object in the current observation",
        );
      }
      let cell: VisualCell | undefined;
      if (at.anchor === "center") {
        const rows = mark.grid.ys.length,
          columns = mark.grid.xs.length;
        if (rows % 2 === 0 || columns % 2 === 0)
          throw new Error(
            `Grid center is ambiguous (${rows} rows, ${columns} columns); choose an explicit cell`,
          );
        cell = { row: (rows + 1) / 2, column: (columns + 1) / 2 };
      } else if (at.anchor === "lastInput") cell = last?.cell;
      else if (typeof at.anchor === "object") cell = at.anchor;
      if (
        !cell ||
        !Number.isInteger(cell.row) ||
        !Number.isInteger(cell.column)
      )
        throw new Error(
          "No observed cell anchor; choose a published cell or center",
        );
      const [dx, dy] = at.direction ? directions[at.direction] : [0, 0];
      const resolved = {
        row: cell.row + dy * distance,
        column: cell.column + dx * distance,
      };
      if (
        resolved.row < 1 ||
        resolved.column < 1 ||
        resolved.row > mark.grid.ys.length ||
        resolved.column > mark.grid.xs.length
      )
        throw new Error("Spatial anchor falls outside the observed grid");
      return { cell: resolved };
    };
    if (step.at && (step.cell || step.position || step.point || step.path))
      throw new Error("Use at without another starting address");
    if (step.toAt && (step.toCell || step.toPosition || step.to || step.path))
      throw new Error("Use toAt without another destination address");
    const { at, toAt, ...rest } = step;
    const start = at ? resolve(step.mark, at) : {};
    const end = toAt ? resolve(step.toMark ?? step.mark, toAt) : undefined;
    const resolved = {
      ...rest,
      ...start,
      ...(end?.cell ? { toCell: end.cell } : {}),
      ...(end?.position ? { toPosition: end.position } : {}),
    };
    // This is preflight of explicit steps. Execution still stops on the first failed delivery.
    if (
      ["click", "doubleClick", "rightClick", "drag"].includes(
        resolved.interaction,
      )
    )
      previous = visualInputEndpoint(resolved);
    return resolved;
  });
};
