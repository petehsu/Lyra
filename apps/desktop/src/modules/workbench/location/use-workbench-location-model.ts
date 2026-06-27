import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GlobalDialogModel } from "../global-dialog";
import { createTranslator } from "../i18n";
import type { WorkbenchLocale } from "../i18n";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import {
  createLocationFix,
  formatCoordinateDisplayName,
  normalizeLocationState,
  selectBestLocationCandidate,
  selectBestPhysicalLocationCandidate,
  serializeLocationState
} from "./model";
import type { WorkbenchLocationControls, WorkbenchLocationState } from "./types";

const LOCATION_STATE_KEY = "location" as const;

type WorkbenchTranslator = ReturnType<typeof createTranslator>;

type UseWorkbenchLocationModelParams = {
  readonly desktopApi: Window["lyraDesktop"] | null;
  readonly openDialog?: GlobalDialogModel["openDialog"];
  readonly locale?: WorkbenchLocale;
  readonly t: WorkbenchTranslator;
};

const readInitialState = (): WorkbenchLocationState =>
  normalizeLocationState(readWorkbenchStateSync(LOCATION_STATE_KEY));

const createDeniedState = (current: WorkbenchLocationState): WorkbenchLocationState => ({
  consent: "denied",
  startupPromptAnswered: true,
  ...(current.fix === undefined ? {} : {})
});

const formatChipTitle = (template: string, label: string): string =>
  template.replace("{label}", label);

export const useWorkbenchLocationModel = ({
  desktopApi,
  openDialog,
  locale,
  t
}: UseWorkbenchLocationModelParams): WorkbenchLocationControls => {
  const [state, setState] = useState<WorkbenchLocationState>(readInitialState);
  const [busy, setBusy] = useState(false);
  const startupPromptOpenedRef = useRef(false);
  const locateInFlightRef = useRef(false);
  const autoLocateAttemptedRef = useRef(false);

  const commitState = useCallback(async (nextState: WorkbenchLocationState): Promise<void> => {
    const json = serializeLocationState(nextState);
    setState(nextState);
    if (desktopApi?.workbenchState !== undefined) {
      await desktopApi.workbenchState.write(LOCATION_STATE_KEY, json);
      return;
    }
    writeWorkbenchStateSync(LOCATION_STATE_KEY, json);
  }, [desktopApi]);

  const locate = useCallback(async (): Promise<void> => {
    if (desktopApi?.location === undefined || locateInFlightRef.current) {
      return;
    }
    locateInFlightRef.current = true;
    setBusy(true);
    try {
      const localePayload = locale === undefined ? {} : { locale };
      const hostResponse = await desktopApi.location.readHostCandidates(localePayload).catch(() => ({
        candidates: []
      }));
      const bestPhysical = selectBestPhysicalLocationCandidate(hostResponse.candidates);
      if (bestPhysical === null) {
        console.warn(
          "[lyra-location] no physical location candidate",
          JSON.stringify(hostResponse.candidates)
        );
        void commitState({
          consent: "granted",
          startupPromptAnswered: true
        });
        return;
      }
      const resolvedResponse = await desktopApi.location.reverseGeocodeCandidates({
        ...localePayload,
        candidates: [bestPhysical]
      }).catch(() => ({ candidates: [bestPhysical] }));
      const selection = selectBestLocationCandidate(resolvedResponse.candidates);
      const coordinateLabel =
        typeof bestPhysical.latitude === "number" && typeof bestPhysical.longitude === "number"
          ? formatCoordinateDisplayName(bestPhysical.latitude, bestPhysical.longitude)
          : null;
      const fix = selection === null
        ? coordinateLabel === null
          ? null
          : createLocationFix({
              candidate: bestPhysical,
              displayName: coordinateLabel
            })
        : createLocationFix(selection);
      void commitState({
        consent: "granted",
        startupPromptAnswered: true,
        ...(fix === null ? {} : { fix })
      });
    } finally {
      locateInFlightRef.current = false;
      setBusy(false);
    }
  }, [commitState, desktopApi, locale]);

  const requestAuthorization = useCallback((): void => {
    if (openDialog === undefined) {
      void commitState({
        consent: "granted",
        startupPromptAnswered: true,
        ...(state.fix === undefined ? {} : { fix: state.fix })
      });
      void locate();
      return;
    }

    const deniedState = createDeniedState(state);
    openDialog({
      title: t("location.authDialogTitle"),
      description: t("location.authDialogDescription"),
      source: {
        title: t("location.authDialogSourceTitle"),
        subtitle: t("location.authDialogSourceSubtitle"),
        iconLabel: "LOC",
        iconTone: "accent"
      },
      actions: [
        {
          id: "deny",
          label: t("location.authDialogDeny"),
          onSelect: () => {
            void commitState(deniedState);
          }
        },
        {
          id: "allow",
          label: t("location.authDialogAllow"),
          tone: "primary",
          onSelect: async () => {
            await commitState({
              consent: "granted",
              startupPromptAnswered: true,
              ...(state.fix === undefined ? {} : { fix: state.fix })
            });
            await locate();
          }
        }
      ]
    });
  }, [commitState, locate, openDialog, state, t]);

  const revokeAuthorization = useCallback((): void => {
    if (openDialog === undefined) {
      void commitState({
        consent: "denied",
        startupPromptAnswered: true
      });
      return;
    }
    openDialog({
      title: t("location.revokeDialogTitle"),
      description: t("location.revokeDialogDescription"),
      source: {
        title: state.fix?.displayName ?? t("location.currentPosition"),
        subtitle: t("location.revokeDialogSubtitle"),
        iconLabel: "LOC",
        iconTone: "danger"
      },
      actions: [
        {
          id: "keep",
          label: t("location.revokeDialogKeep")
        },
        {
          id: "revoke",
          label: t("location.revokeDialogConfirm"),
          tone: "danger",
          onSelect: () => {
            void commitState({
              consent: "denied",
              startupPromptAnswered: true
            });
          }
        }
      ]
    });
  }, [commitState, openDialog, state.fix?.displayName, t]);

  useEffect(() => {
    if (startupPromptOpenedRef.current || state.startupPromptAnswered || state.consent !== "unknown") {
      return;
    }
    startupPromptOpenedRef.current = true;
    requestAuthorization();
  }, [requestAuthorization, state.consent, state.startupPromptAnswered]);

  useEffect(() => {
    if (
      state.consent !== "granted" ||
      state.fix !== undefined ||
      busy ||
      autoLocateAttemptedRef.current
    ) {
      return;
    }
    autoLocateAttemptedRef.current = true;
    void locate();
  }, [busy, locate, state.consent, state.fix]);

  useEffect(() => {
    const unsubscribe = desktopApi?.workbenchState.onDidChange((event) => {
      if (event.key === LOCATION_STATE_KEY) {
        setState(normalizeLocationState(event.json));
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [desktopApi]);

  const controls = useMemo<WorkbenchLocationControls>(() => {
    const hasConsent = state.consent === "granted";
    const located = hasConsent && state.fix !== undefined;
    const status = busy
      ? "locating"
      : located
        ? "located"
        : hasConsent
          ? "unavailable"
          : "unauthorized";
    const unlocatedLabel = t("location.unlocated");
    const displayName = state.fix?.displayName ?? unlocatedLabel;
    const label = status === "located"
      ? t("location.located")
      : status === "locating"
        ? t("location.locating")
        : status === "unavailable"
          ? unlocatedLabel
          : t("location.authorize");
    return {
      status,
      label,
      title: hasConsent
        ? located
          ? formatChipTitle(t("location.chipTitleLocated"), displayName)
          : status === "unavailable"
            ? t("location.chipTitleUnavailable")
            : t("location.chipTitleRetry")
        : t("location.chipTitleAuthorize"),
      busy,
      hasConsent,
      onPress: hasConsent
        ? located
          ? revokeAuthorization
          : () => {
              autoLocateAttemptedRef.current = true;
              const shouldOpenSystemSettings =
                desktopApi?.appMeta.platform === "darwin" &&
                desktopApi.appMeta.isPackaged === false &&
                desktopApi.location?.openSystemSettings !== undefined;
              if (shouldOpenSystemSettings) {
                void desktopApi.location.openSystemSettings().finally(() => {
                  void locate();
                });
                return;
              }
              void locate();
            }
        : requestAuthorization
    };
  }, [busy, desktopApi, locate, requestAuthorization, revokeAuthorization, state.consent, state.fix, t]);

  return controls;
};