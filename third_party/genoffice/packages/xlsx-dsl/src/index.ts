import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assembleWithJsZip,
  createBufferEntrySource,
  planCellEditsToXlsx,
  type SheetFormulaValues,
} from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'

import { runWorkbookDsl } from './xlsx-dsl'
import { cachedFormulaValues, xlsxSidecarPath } from './xlsx'

export async function applyWorkbookOps(
  source: Buffer,
  rawOps: readonly unknown[],
  opts: { sourcePath?: string } = {},
): Promise<{ readonly buffer: Uint8Array; readonly applied: number }> {
  const outcome = await runWorkbookDsl(source, [...rawOps], undefined, undefined, {
    sourcePath: opts.sourcePath,
  })
  const save = async (formulaValues: readonly SheetFormulaValues[]) => {
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
      formulaValues,
    )
    return assembleWithJsZip(source, plan)
  }
  const first = await save([])
  const formulaCells = outcome.edits.filter((edit) => edit.cell.formula)
  if (formulaCells.length === 0 || !xlsxSidecarPath()) {
    return { buffer: new Uint8Array(first.buffer), applied: rawOps.length }
  }
  const dir = await mkdtemp(join(tmpdir(), 'lyra-xlsx-cache-'))
  try {
    const written = join(dir, 'written.xlsx')
    await writeFile(written, first.buffer)
    let values: SheetFormulaValues[]
    try {
      values = await cachedFormulaValues(written, formulaCells, outcome.renames)
    } catch {
      // The formulas are already in the first write. A sidecar miss leaves their cache empty.
      return { buffer: new Uint8Array(first.buffer), applied: rawOps.length }
    }
    if (values.length === 0) return { buffer: new Uint8Array(first.buffer), applied: rawOps.length }
    const second = await save(values)
    return { buffer: new Uint8Array(second.buffer), applied: rawOps.length }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
