import type {
  WorkbenchWebContainerNode,
  WorkbenchWebPageMode,
  WorkbenchWebElementSignature,
  WorkbenchWebSelectorAddress,
  WorkbenchWebTargetCandidate,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanScope,
  WorkbenchWebWidgetDescriptor,
} from "../../../shared/workbench-web-automation";
import type { LayoutContainerHint } from "../layout-intelligence/types";

export type LiveSelectorScanCandidateRecord = WorkbenchWebTargetCandidate & {
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly stableSignature: WorkbenchWebElementSignature;
  readonly disabled?: boolean;
  readonly frameUrl?: string;
  readonly containerHint?: LayoutContainerHint;
};

export type LiveSelectorFrameScanCandidate = {
  readonly tagName: string;
  readonly role?: string;
  readonly inputType?: string;
  readonly selectorPreview: string;
  readonly textSnippet?: string;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly visibilityState: "visible" | "nearby" | "offscreen" | "hidden";
  readonly interactable: {
    readonly clickable: boolean;
    readonly typable: boolean;
    readonly selectable: boolean;
    readonly focusable: boolean;
  };
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly stableSignature: WorkbenchWebElementSignature;
  readonly containerHint?: LayoutContainerHint;
};

export type LiveSelectorFrameScanResult = {
  readonly candidates: readonly LiveSelectorFrameScanCandidate[];
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly scrollX: number;
    readonly scrollY: number;
  };
};

export type LiveSelectorScanSession = {
  readonly scanSessionId: string;
  readonly tabId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly intent: WorkbenchWebTargetIntent;
  readonly pageMode: WorkbenchWebPageMode;
  readonly widgets: readonly WorkbenchWebWidgetDescriptor[];
  readonly containerNodes: readonly WorkbenchWebContainerNode[];
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
};

export type LiveSelectorExpandedRequest = WorkbenchWebTargetScanRequest & {
  readonly tabId: string;
  readonly scope: WorkbenchWebTargetScanScope;
};
