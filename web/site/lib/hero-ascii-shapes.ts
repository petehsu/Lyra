import { LYRA_ASCII_LOGO } from "@/lib/ascii-logo";

export const HERO_ASCII_SHAPES = [
  "lyra",
  "fast",
  "local",
  "smart"
] as const;

export type HeroAsciiShape = (typeof HERO_ASCII_SHAPES)[number];

export type HeroAsciiPoint = {
  readonly x: number;
  readonly y: number;
  readonly character: string;
};

type Point = {
  readonly x: number;
  readonly y: number;
};

const fract = (value: number) => value - Math.floor(value);
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const logoRows = LYRA_ASCII_LOGO.split("\n");
const logoColumnCount = Math.max(...logoRows.map((row) => row.length));
const logoCharacterWidth = 0.6;
const logoLineHeight = 1.05;
const logoWidth = logoColumnCount * logoCharacterWidth;
const logoHeight = logoRows.length * logoLineHeight;
const logoScale = Math.max(logoWidth, logoHeight);
const logoOffsetX = (logoScale - logoWidth) / (logoScale * 2);
const logoOffsetY = (logoScale - logoHeight) / (logoScale * 2);

const sourcePoints = logoRows
  .flatMap((row, rowIndex) =>
    Array.from(row).flatMap((character, columnIndex) =>
      character === " "
        ? []
        : [{
            character,
            columnIndex,
            rowIndex
          }]
    )
  )
  .sort(
    (a, b) =>
      ((a.columnIndex * 73 + a.rowIndex * 151) % 997)
      - ((b.columnIndex * 73 + b.rowIndex * 151) % 997)
  );

const lyraPositions = sourcePoints.map(({ columnIndex, rowIndex }) => ({
  x:
    logoOffsetX
    + (columnIndex + 0.5) * logoCharacterWidth / logoScale,
  y: logoOffsetY + (rowIndex + 0.5) * logoLineHeight / logoScale
}));

const circle = (
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY = radiusX,
  steps = 48
) =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const angle = index / steps * Math.PI * 2;
    return {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY
    };
  });

const roundedRectangle = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  cornerSteps = 10
) => {
  const corners = [
    { x: x + width - radius, y: y + radius, start: -Math.PI / 2 },
    {
      x: x + width - radius,
      y: y + height - radius,
      start: 0
    },
    { x: x + radius, y: y + height - radius, start: Math.PI / 2 },
    { x: x + radius, y: y + radius, start: Math.PI }
  ];

  return corners.flatMap((corner, cornerIndex) =>
    Array.from({ length: cornerSteps + 1 }).flatMap((_, step) => {
      if (cornerIndex > 0 && step === 0) return [];
      const angle = corner.start + step / cornerSteps * Math.PI / 2;
      return [{
        x: corner.x + Math.cos(angle) * radius,
        y: corner.y + Math.sin(angle) * radius
      }];
    })
  );
};

const pointInPolygon = (point: Point, polygon: readonly Point[]) => {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const currentPoint = polygon[current];
    const previousPoint = polygon[previous];
    const crosses =
      (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x
        < (
          (previousPoint.x - currentPoint.x)
          * (point.y - currentPoint.y)
          / (previousPoint.y - currentPoint.y)
          + currentPoint.x
        );
    if (crosses) inside = !inside;
  }
  return inside;
};

const sampleFilledPolygon = (
  polygon: readonly Point[],
  count: number
) => {
  const result: Point[] = [];
  let attempt = 0;
  while (result.length < count && attempt < count * 100) {
    const point = {
      x: 0.04 + fract((attempt + 1) * 0.754877666) * 0.92,
      y: 0.04 + fract((attempt + 1) * 0.569840296) * 0.92
    };
    if (pointInPolygon(point, polygon)) result.push(point);
    attempt += 1;
  }
  return result;
};

const sampleStrokes = (
  paths: readonly (readonly Point[])[],
  count: number,
  thickness: number
) => {
  const segments = paths.flatMap((path) =>
    path.slice(1).map((point, index) => {
      const previous = path[index];
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      return {
        start: previous,
        dx,
        dy,
        length: Math.hypot(dx, dy)
      };
    })
  );
  const totalLength = segments.reduce(
    (total, segment) => total + segment.length,
    0
  );

  return Array.from({ length: count }, (_, index) => {
    let distance = fract((index + 0.5) * 0.61803398875) * totalLength;
    const segment =
      segments.find((candidate) => {
        if (distance <= candidate.length) return true;
        distance -= candidate.length;
        return false;
      }) ?? segments[segments.length - 1];
    const progress = segment.length === 0 ? 0 : distance / segment.length;
    const normalX = segment.length === 0 ? 0 : -segment.dy / segment.length;
    const normalY = segment.length === 0 ? 0 : segment.dx / segment.length;
    const jitter =
      (fract((index + 0.5) * 0.41421356237) - 0.5) * thickness;

    return {
      x: clamp(
        segment.start.x + segment.dx * progress + normalX * jitter,
        0.02,
        0.98
      ),
      y: clamp(
        segment.start.y + segment.dy * progress + normalY * jitter,
        0.02,
        0.98
      )
    };
  });
};

const createFastPositions = (count: number) => {
  const bolt = [
    { x: 0.6, y: 0.04 },
    { x: 0.23, y: 0.52 },
    { x: 0.47, y: 0.52 },
    { x: 0.35, y: 0.96 },
    { x: 0.8, y: 0.4 },
    { x: 0.55, y: 0.4 }
  ];
  const fillCount = Math.floor(count * 0.82);
  return [
    ...sampleFilledPolygon(bolt, fillCount),
    ...sampleStrokes(
      [
        [{ x: 0.08, y: 0.3 }, { x: 0.38, y: 0.3 }],
        [{ x: 0.04, y: 0.4 }, { x: 0.34, y: 0.4 }],
        [{ x: 0.1, y: 0.62 }, { x: 0.37, y: 0.62 }]
      ],
      count - fillCount,
      0.04
    )
  ];
};

const createLocalPositions = (count: number) =>
  sampleStrokes(
    [
      roundedRectangle(0.12, 0.16, 0.76, 0.68, 0.09),
      [{ x: 0.12, y: 0.62 }, { x: 0.88, y: 0.62 }],
      circle(0.5, 0.39, 0.17, 0.17),
      circle(0.5, 0.39, 0.045, 0.045, 20),
      [{ x: 0.65, y: 0.73 }, { x: 0.72, y: 0.73 }],
      [{ x: 0.77, y: 0.73 }, { x: 0.84, y: 0.73 }]
    ],
    count,
    0.042
  );

const createSmartPositions = (count: number) => {
  const leftOutline = [
    { x: 0.5, y: 0.16 },
    { x: 0.42, y: 0.1 },
    { x: 0.32, y: 0.11 },
    { x: 0.24, y: 0.18 },
    { x: 0.21, y: 0.27 },
    { x: 0.15, y: 0.35 },
    { x: 0.14, y: 0.47 },
    { x: 0.19, y: 0.56 },
    { x: 0.16, y: 0.65 },
    { x: 0.2, y: 0.75 },
    { x: 0.29, y: 0.83 },
    { x: 0.4, y: 0.82 },
    { x: 0.47, y: 0.75 },
    { x: 0.5, y: 0.7 }
  ];
  const mirror = (path: readonly Point[]) =>
    path.map((point) => ({ x: 1 - point.x, y: point.y }));

  return sampleStrokes(
    [
      leftOutline,
      mirror(leftOutline),
      [{ x: 0.5, y: 0.16 }, { x: 0.5, y: 0.78 }],
      [
        { x: 0.5, y: 0.31 },
        { x: 0.4, y: 0.28 },
        { x: 0.32, y: 0.34 }
      ],
      [
        { x: 0.5, y: 0.47 },
        { x: 0.38, y: 0.47 },
        { x: 0.29, y: 0.43 }
      ],
      [
        { x: 0.5, y: 0.62 },
        { x: 0.39, y: 0.65 },
        { x: 0.32, y: 0.72 }
      ],
      mirror([
        { x: 0.5, y: 0.31 },
        { x: 0.4, y: 0.28 },
        { x: 0.32, y: 0.34 }
      ]),
      mirror([
        { x: 0.5, y: 0.47 },
        { x: 0.38, y: 0.47 },
        { x: 0.29, y: 0.43 }
      ]),
      mirror([
        { x: 0.5, y: 0.62 },
        { x: 0.39, y: 0.65 },
        { x: 0.32, y: 0.72 }
      ]),
      circle(0.32, 0.34, 0.025, 0.025, 16),
      circle(0.29, 0.43, 0.025, 0.025, 16),
      circle(0.32, 0.72, 0.025, 0.025, 16),
      circle(0.68, 0.34, 0.025, 0.025, 16),
      circle(0.71, 0.43, 0.025, 0.025, 16),
      circle(0.68, 0.72, 0.025, 0.025, 16)
    ],
    count,
    0.038
  );
};

const positionsByShape: Record<HeroAsciiShape, readonly Point[]> = {
  lyra: lyraPositions,
  fast: createFastPositions(sourcePoints.length),
  local: createLocalPositions(sourcePoints.length),
  smart: createSmartPositions(sourcePoints.length)
};

export const HERO_ASCII_POINT_COUNT = sourcePoints.length;

const attachCharacters = (positions: readonly Point[]) =>
  positions.map((point, index) => ({
    ...point,
    character: sourcePoints[index].character
  }));

export const HERO_ASCII_SHAPE_POINTS: Record<
  HeroAsciiShape,
  readonly HeroAsciiPoint[]
> = {
  lyra: attachCharacters(positionsByShape.lyra),
  fast: attachCharacters(positionsByShape.fast),
  local: attachCharacters(positionsByShape.local),
  smart: attachCharacters(positionsByShape.smart)
};

export const renderHeroAsciiShape = (
  shape: HeroAsciiShape,
  columns = 58,
  rows = 30
) => {
  const density = Array.from(
    { length: rows },
    () => Array<number>(columns).fill(0)
  );
  HERO_ASCII_SHAPE_POINTS[shape].forEach((point) => {
    const column = clamp(Math.floor(point.x * columns), 0, columns - 1);
    const row = clamp(Math.floor(point.y * rows), 0, rows - 1);
    density[row][column] += 1;
  });
  const characters = [" ", ".", ":", "+", "*", "#", "%", "@"];
  return density
    .map((row) =>
      row
        .map((value) => characters[Math.min(value, characters.length - 1)])
        .join("")
        .trimEnd()
    )
    .join("\n");
};
