import type {
  WorkbenchWebElementSignature,
  WorkbenchWebSelectorAddress,
  WorkbenchWebTargetCandidate,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanScope,
} from "../../../shared/workbench-web-automation";

export type LiveSelectorScanCandidateRecord = WorkbenchWebTargetCandidate & {
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly stableSignature: WorkbenchWebElementSignature;
  readonly disabled?: boolean;
  readonly frameUrl?: string;
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
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
};

export type LiveSelectorExpandedRequest = WorkbenchWebTargetScanRequest & {
  readonly tabId: string;
  readonly scope: WorkbenchWebTargetScanScope;
};
