import type {
  LyraNestedAppSlotResultV1,
  LyraNestedAppSlotsV1
} from "@lyra/app-runtime";

const unavailable = <T>(): LyraNestedAppSlotResultV1<T> => ({
  ok: false,
  error: {
    code: "app-unavailable",
    message: "Nested applications are not configured for this isolated surface test.",
    repairable: true
  }
});

export const isolatedSurfaceSlots: LyraNestedAppSlotsV1 = {
  create: async () => unavailable(),
  restore: async () => unavailable(),
  mount: async () => unavailable(),
  unmount: async () => ({ ok: true, value: null }),
  snapshot: async () => unavailable(),
  close: async () => ({ ok: true, value: null })
};
