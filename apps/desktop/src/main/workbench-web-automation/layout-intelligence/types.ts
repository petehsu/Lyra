import type {
  WorkbenchWebContainerNode,
  WorkbenchWebElementBounds,
  WorkbenchWebElementSignature,
  WorkbenchWebItemIdentity,
  WorkbenchWebLayoutNode,
  WorkbenchWebPageMode,
  WorkbenchWebSelectorAddress,
  WorkbenchWebTargetCandidate,
  WorkbenchWebTargetDiscoveryMode,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanScope,
  WorkbenchWebWidgetDescriptor,
  WorkbenchWebWidgetKind,
} from "../../../shared/workbench-web-automation";

export type LayoutContainerHint = {
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly tagName: string;
  readonly role?: string;
  readonly label?: string;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchWebElementBounds;
  readonly protected?: boolean;
};

export type LayoutFrameInteractiveNode = {
  readonly tagName: string;
  readonly role?: string;
  readonly inputType?: string;
  readonly selectorPreview: string;
  readonly textSnippet?: string;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly affordanceLabel?: string;
  readonly affordanceAction?: string;
  readonly cursorStyle?: string;
  readonly tooltipText?: string;
  readonly stateHint?: string;
  readonly isHumanOperable?: boolean;
  readonly tabIndex?: number;
  readonly documentOrder: number;
  readonly disabled?: boolean;
  readonly href?: string;
  readonly value?: string;
  readonly checked?: boolean;
  readonly visibilityState: "visible" | "nearby" | "offscreen" | "hidden";
  readonly interactable: WorkbenchWebTargetCandidate["interactable"];
  readonly bounds: WorkbenchWebElementBounds;
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly stableSignature: WorkbenchWebElementSignature;
  readonly containerHint?: LayoutContainerHint;
};

export type LayoutFrameScanResult = {
  readonly interactiveNodes: readonly LayoutFrameInteractiveNode[];
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly scrollX: number;
    readonly scrollY: number;
  };
};

export type LayoutInteractiveRecord = LayoutFrameInteractiveNode & {
  readonly candidateId: string;
  readonly frameTreeNodeId: number;
  readonly frameUrl?: string;
  readonly containerId?: string;
  readonly widgetId?: string;
  readonly ownerWidgetId?: string;
  readonly widgetKind?: WorkbenchWebWidgetKind;
  readonly itemIdentity?: WorkbenchWebItemIdentity;
  readonly discoveryMode?: WorkbenchWebTargetDiscoveryMode;
};

export type LayoutIntelligenceSnapshot = {
  readonly pageMode: WorkbenchWebPageMode;
  readonly layoutNodes: readonly WorkbenchWebLayoutNode[];
  readonly containerNodes: readonly WorkbenchWebContainerNode[];
  readonly widgets: readonly WorkbenchWebWidgetDescriptor[];
  readonly candidates: readonly LayoutInteractiveRecord[];
};

export type WidgetGraphInput = {
  readonly candidates: readonly LayoutInteractiveRecord[];
  readonly scope: WorkbenchWebTargetScanScope;
  readonly intent?: WorkbenchWebTargetIntent;
};
