import { ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type LocationHostCandidatesRequest,
  type LocationHostCandidatesResponse,
  type LocationReverseGeocodeRequest,
  type LocationReverseGeocodeResponse,
  type LyraDesktopApi
} from "../../shared/desktop-bridge";

export const createLocationBridgeApi = (): Pick<LyraDesktopApi, "location"> => ({
  location: {
    readHostCandidates: (request?: LocationHostCandidatesRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.locationReadHostCandidates,
        request ?? {}
      ) as Promise<LocationHostCandidatesResponse>,
    openSystemSettings: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.locationOpenSystemSettings) as Promise<boolean>,
    reverseGeocodeCandidates: (request: LocationReverseGeocodeRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.locationReverseGeocodeCandidates,
        request
      ) as Promise<LocationReverseGeocodeResponse>
  }
});
