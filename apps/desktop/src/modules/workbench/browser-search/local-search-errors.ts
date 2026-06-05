export const LOCAL_SEARCH_STREAM_TIMEOUT_ERROR =
  "lyra:local-search:stream-timeout";

export const resolveLocalSearchErrorLabel = (
  error: string | undefined,
  labels: {
    readonly streamTimeout: string;
  }
): string | undefined => {
  switch (error) {
    case LOCAL_SEARCH_STREAM_TIMEOUT_ERROR:
      return labels.streamTimeout;
    default:
      return error;
  }
};
