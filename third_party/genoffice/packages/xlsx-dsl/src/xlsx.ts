/** Formula results come from GenOffice's native sidecar, which this build does not include. */
export async function computedValues(): Promise<never> {
  throw new Error('formula evaluation is not built in')
}
