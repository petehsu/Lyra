import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface, type Interface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'

import type { CellEdit, SheetFormulaValues } from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'

/** The sidecar rejects a recalc read above this many cells (recalc.rs MAX_RECALC_READ_CELLS). */
const RECALC_CELL_CAP = 20_000
const PROTOCOL_VERSION = 1
const REQUEST_TIMEOUT_MS = 60_000
/** Functions the engine cannot compute stay formula cells with an empty cache. */
const UNCACHED_RESULTS = new Set(['#NAME?', '#ERROR!'])

type Bounds = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

type RecalcCell = {
  sheet: string
  row: number
  column: number
  formatted: string
  number?: number
  isError: boolean
}

type Scalar = string | number | boolean | null

const binaryName = (): string => (process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar')

/** Env override, then the packaged binary, then a release build walked up from this file. */
export function xlsxSidecarPath(): string | null {
  const name = binaryName()
  const candidates: string[] = []
  if (process.env.XLSX_SIDECAR_PATH) candidates.push(process.env.XLSX_SIDECAR_PATH)
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resources) candidates.push(join(resources, name))
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i += 1) {
    candidates.push(join(dir, 'third_party/genoffice/native/xlsx-engine/target/release', name))
    candidates.push(join(dir, 'native/xlsx-engine/target/release', name))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return candidates.find((path) => existsSync(path)) ?? null
}

class SidecarClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()

  constructor(private readonly binaryPath: string) {}

  async recalcCells(path: string, sheet: string, range: Bounds): Promise<RecalcCell[]> {
    const result = await this.request({
      command: 'recalc_cells',
      path,
      edits: [],
      reads: [{ sheet, range }],
    }) as { cells?: RecalcCell[] }
    return result.cells ?? []
  }

  private request(command: Record<string, unknown>): Promise<unknown> {
    const child = this.ensureStarted()
    const requestId = crypto.randomUUID()
    const payload = JSON.stringify({ version: PROTOCOL_VERSION, requestId, ...command })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('xlsx sidecar request timed out'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timer })
      child.stdin.write(`${payload}\n`)
    })
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.process = child
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => this.handleLine(line))
    child.once('exit', () => {
      this.process = null
      this.lines?.close()
      this.lines = null
      this.rejectPending(new Error('xlsx sidecar exited'))
    })
    child.once('error', (error) => {
      this.process = null
      this.rejectPending(error)
    })
    return child
  }

  private handleLine(line: string): void {
    let message: { requestId?: string; ok?: boolean; result?: unknown; error?: { message?: string } }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      return
    }
    if (!message.requestId) return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    this.pending.delete(message.requestId)
    clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error?.message ?? 'xlsx sidecar failed'))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

let client: SidecarClient | null = null

const sidecar = (): SidecarClient => {
  const path = xlsxSidecarPath()
  if (!path) throw new Error('formula evaluation is not built in')
  client ??= new SidecarClient(path)
  return client
}

const bands = (bounds: Bounds): Bounds[] => {
  const width = bounds.endColumn - bounds.startColumn + 1
  const out: Bounds[] = []
  const colStep = Math.min(width, RECALC_CELL_CAP)
  for (let column = bounds.startColumn; column <= bounds.endColumn; column += colStep) {
    const endColumn = Math.min(bounds.endColumn, column + colStep - 1)
    const rowStep = Math.max(1, Math.floor(RECALC_CELL_CAP / (endColumn - column + 1)))
    for (let row = bounds.startRow; row <= bounds.endRow; row += rowStep) {
      out.push({
        startRow: row,
        endRow: Math.min(bounds.endRow, row + rowStep - 1),
        startColumn: column,
        endColumn,
      })
    }
  }
  return out
}

const box = (cells: readonly { row: number; column: number }[]): Bounds => {
  const bounds = { startRow: Infinity, endRow: -Infinity, startColumn: Infinity, endColumn: -Infinity }
  for (const cell of cells) {
    if (cell.row < bounds.startRow) bounds.startRow = cell.row
    if (cell.row > bounds.endRow) bounds.endRow = cell.row
    if (cell.column < bounds.startColumn) bounds.startColumn = cell.column
    if (cell.column > bounds.endColumn) bounds.endColumn = cell.column
  }
  return bounds
}

/**
 * IronCalc rejects whitespace text between rows, and a formula cell with no cached
 * `<v>` is typed as empty so the formula is never evaluated. The copy is only for
 * the sidecar; the caller's file is unchanged.
 */
const sidecarCopy = async (path: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await readFile(path))
  const pending: Promise<void>[] = []
  zip.forEach((name, entry) => {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) return
    pending.push(entry.async('string').then((xml) => {
      const compact = xml.replace(/>\s+</g, '><')
      const primed = compact.replace(
        /(<c\b[^>]*>)(<f\b[^>]*>[\s\S]*?<\/f>)(<\/c>)/g,
        (whole, open: string, formula: string, close: string) =>
          whole.includes('<v') ? whole : `${open}${formula}<v>0</v>${close}`,
      )
      if (primed !== xml) zip.file(name, primed)
    }))
  })
  await Promise.all(pending)
  const copy = `${path}.sidecar.xlsx`
  await writeFile(copy, await zip.generateAsync({ type: 'nodebuffer' }))
  return copy
}

/** What the workbook engine computes for a range on disk, keyed `row|column` (0-based). */
export async function computedValues(
  path: string,
  sheet: string,
  bounds: Bounds,
): Promise<Map<string, { value: Scalar; isError: boolean }>> {
  const out = new Map<string, { value: Scalar; isError: boolean }>()
  const engine = sidecar()
  const readable = await sidecarCopy(path)
  for (const range of bands(bounds)) {
    for (const cell of await engine.recalcCells(readable, sheet, range)) {
      out.set(`${cell.row}|${cell.column}`, {
        value: cell.number ?? (cell.formatted === '' ? null : cell.formatted),
        isError: cell.isError === true,
      })
    }
  }
  return out
}

/** Cached `<v>` values for formula edits, keyed by the file's original sheet names. */
export async function cachedFormulaValues(
  path: string,
  formulaCells: readonly CellEdit[],
  renames: Record<string, string>,
): Promise<SheetFormulaValues[]> {
  const bySheet = new Map<string, CellEdit[]>()
  for (const edit of formulaCells) {
    bySheet.set(edit.sheetName, [...(bySheet.get(edit.sheetName) ?? []), edit])
  }
  const wanted = new Set(formulaCells.map((cell) => `${cell.sheetName} ${cell.row} ${cell.column}`))
  const originalName = (written: string): string =>
    Object.entries(renames).find(([, after]) => after === written)?.[0] ?? written
  const engine = sidecar()
  const readable = await sidecarCopy(path)
  const out: SheetFormulaValues[] = []
  for (const [sheet, cells] of bySheet) {
    const values: SheetFormulaValues['cells'][number][] = []
    for (const cell of await engine.recalcCells(readable, renames[sheet] ?? sheet, box(cells))) {
      if (!wanted.has(`${originalName(cell.sheet)} ${cell.row} ${cell.column}`)) continue
      const value = UNCACHED_RESULTS.has(cell.formatted)
        ? null
        : cell.isError
          ? { error: cell.formatted }
          : cell.number ?? (cell.formatted === '' ? null : cell.formatted)
      values.push({ row: cell.row, column: cell.column, value })
    }
    if (values.length) out.push({ sheetName: sheet, cells: values })
  }
  return out
}
