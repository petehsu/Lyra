export type InputField = {
  readonly elementId: number;
  readonly targetRef: string;
  readonly tagName: string;
  readonly role: string;
  readonly label: string;
  readonly editable: boolean;
  readonly disabled: boolean;
  readonly textSnippet: string;
  readonly maxLength?: number | undefined;
  readonly frameRef?: string | undefined;
  readonly groupKey?: string | undefined;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

const SAME_ROW = 8;
const BOX = 56;
const GAP = 24;

const centerY = (field: InputField): number => field.bounds.y + field.bounds.height / 2;

const isSplitBox = (field: InputField): boolean =>
  field.editable
  && field.disabled !== true
  && field.tagName.toLowerCase() !== "textarea"
  && field.maxLength === 1
  && field.bounds.width > 0
  && field.bounds.width <= BOX * 2
  && field.bounds.height > 0
  && field.bounds.height <= BOX * 2;

export const groupSplitFields = (fields: readonly InputField[]): readonly (readonly InputField[])[] => {
  const boxes = fields.filter(isSplitBox).slice().sort((left, right) => left.bounds.x - right.bounds.x);
  const groups: InputField[][] = [];
  for (const box of boxes) {
    const group = groups.find((candidate) => {
      const tail = candidate[candidate.length - 1];
      if (tail === undefined || tail.frameRef !== box.frameRef || tail.groupKey !== box.groupKey) return false;
      const gap = box.bounds.x - (tail.bounds.x + tail.bounds.width);
      return Math.abs(centerY(box) - centerY(tail)) <= SAME_ROW && gap >= -4 && gap <= Math.max(GAP, box.bounds.width);
    });
    if (group === undefined) {
      groups.push([box]);
    } else {
      group.push(box);
    }
  }
  return groups.filter((group) => group.length >= 2);
};
