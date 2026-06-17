import type {
  LocationCandidate,
  LocationResolvedAddress,
  LocationResolvedCandidate
} from "../../../shared/desktop-bridge";

export type WorkbenchLocationConsent = "unknown" | "granted" | "denied";

export type WorkbenchLocationFix = {
  readonly displayName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
  readonly source: LocationCandidate["source"];
  readonly capturedAt: string;
  readonly expiresAt: string;
  readonly address?: LocationResolvedAddress;
};

export type WorkbenchLocationState = {
  readonly consent: WorkbenchLocationConsent;
  readonly startupPromptAnswered: boolean;
  readonly fix?: WorkbenchLocationFix;
};

export type WorkbenchLocationStatus =
  | "unauthorized"
  | "locating"
  | "located"
  | "unavailable";

export type WorkbenchLocationControls = {
  readonly status: WorkbenchLocationStatus;
  readonly label: string;
  readonly title: string;
  readonly busy: boolean;
  readonly hasConsent: boolean;
  readonly onPress: () => void;
};

export type WorkbenchLocationSelection = {
  readonly candidate: LocationResolvedCandidate;
  readonly displayName: string;
};
