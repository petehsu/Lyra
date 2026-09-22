import {
  assembleWithJsZip,
  createBufferEntrySource,
  planCellEditsToXlsx,
} from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'

import { runWorkbookDsl } from './xlsx-dsl'

export async function applyWorkbookOps(
  source: Buffer,
  rawOps: readonly unknown[],
): Promise<{ readonly buffer: Uint8Array; readonly applied: number }> {
  const outcome = await runWorkbookDsl(source, [...rawOps])
  const plan = await planCellEditsToXlsx(
    await createBufferEntrySource(source),
    outcome.edits,
    outcome.structuralOps,
    outcome.gateway.chartEdits,
    outcome.sheetPlan,
    outcome.gateway.filterStates,
    outcome.gateway.hyperlinkEdits,
    outcome.gateway.cfStates,
    outcome.gateway.dvStates,
    outcome.gateway.sheetProtections,
    outcome.gateway.definedNamesState,
    outcome.gateway.visualAdditions,
    outcome.gateway.pageSetupStates,
    outcome.gateway.noteStates,
    outcome.gateway.tableAdditions,
    outcome.gateway.pivotAdditions,
    [],
    [],
    [],
    outcome.gateway.sparklineAdditions,
  )
  const mutation = await assembleWithJsZip(source, plan)
  return { buffer: new Uint8Array(mutation.buffer), applied: rawOps.length }
}
