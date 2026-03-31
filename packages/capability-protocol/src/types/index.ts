export type CapabilityKind = "resource" | "tool" | "event";

export type CapabilityDescriptor = {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly title: string;
};
