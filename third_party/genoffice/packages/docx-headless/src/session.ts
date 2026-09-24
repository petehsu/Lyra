import {
  BLANK_BULLET_NUM_ID,
  BLANK_ORDERED_NUM_ID,
  findChartWorkbookPath,
  nextNoteId,
  parseChartPartXml,
  parseDocx,
  patchChartPartXml,
  patchChartWorkbookXlsxBase64,
  pendingHeadingLevel,
  readDocxPartBase64,
  readSections,
  saveDocx,
  type CommentInfo,
  type HeaderFooter,
  type HfPartInfo,
  type NoteInfo,
  type SaveOptions,
  type StyleUpsert,
  type Watermark,
} from '@genoffice/docx-engine'

import { ensureDom } from './dom'
import { readLocalImage } from './images'
import { applySectionEdits, listSections, pageSetupAccess } from './sections'

const PREVIEW_CHARS = 200

const ALLOWED = new Set([
  'set_text',
  'insert_content',
  'replace_blocks',
  'add_comment',
  'reply_comment',
  'resolve_comment',
  'delete_comment',
  'insert_footnote',
  'insert_endnote',
  'edit_note',
  'delete_note',
  'set_header_footer',
  'setFont',
  'setMatchedFont',
  'setParagraphFormat',
  'setParagraphAttrs',
  'stepIndent',
  'stepHangingIndent',
  'setHeadingLevel',
  'setList',
  'clearList',
  'findReplace',
  'deleteBlocks',
  'moveBlocks',
  'set_page_setup',
  'insert_section_break',
  'accept_changes',
  'reject_changes',
  'insertTableRow',
  'deleteTableRow',
  'insertTableColumn',
  'deleteTableColumn',
  'mergeTableCells',
  'splitTableCell',
  'setTableCellFormat',
  'setTableStyle',
  'insertField',
  'insertBookmark',
  'updateFields',
  'insertToc',
  'setImageProperties',
  'applyStyle',
  'insert_chart',
  'edit_chart',
  'insert_text_box',
  'insert_image',
  'insert_picture',
  'define_style',
  'list_styles',
  'set_watermark',
])

const BLOCK_OPS = new Set([
  'setFont',
  'setMatchedFont',
  'setParagraphFormat',
  'setParagraphAttrs',
  'stepIndent',
  'stepHangingIndent',
  'setHeadingLevel',
  'setList',
  'clearList',
  'findReplace',
  'deleteBlocks',
  'moveBlocks',
  'insertTableRow',
  'deleteTableRow',
  'insertTableColumn',
  'deleteTableColumn',
  'mergeTableCells',
  'splitTableCell',
  'setTableCellFormat',
  'setTableStyle',
  'insertField',
  'insertBookmark',
  'updateFields',
  'insertToc',
  'setImageProperties',
  'applyStyle',
])

export class DocxHeadlessError extends Error {
  readonly index: number

  constructor(index: number, message: string) {
    super(message)
    this.name = 'DocxHeadlessError'
    this.index = index
  }
}

export type DocxBlockSummary = {
  readonly index: number
  readonly type: string
  readonly preview: string
}

export type DocxCommentSummary = {
  readonly id: string
  readonly text: string
  readonly author?: string
  readonly parentId?: string
  readonly blockIndex?: number
}

export type DocxNoteSummary = {
  readonly kind: 'footnote' | 'endnote'
  readonly id: string
  readonly text: string
  readonly blockIndex?: number
}

export type DocxHeaderFooterSummary = {
  readonly header: string
  readonly footer: string
  readonly headerFirst: string | null
  readonly footerFirst: string | null
  readonly headerEven: string | null
  readonly footerEven: string | null
}

export type DocxRevisionSummary = {
  readonly id: string
  readonly type: string
  readonly blockIndex: number
  readonly text: string
  readonly author: string
  readonly date?: string
  readonly change?: string
}

export type DocxStyleSummary = {
  readonly styleId: string
  readonly name: string
  readonly type: string
  readonly headingLevel?: number
}

export type DocxSectionSummary = {
  readonly index: number
  readonly firstBlock: number
  readonly lastBlock: number
  readonly summary: string
}

export type DocxDescription = {
  readonly blocks: readonly DocxBlockSummary[]
  readonly comments: readonly DocxCommentSummary[]
  readonly notes: readonly DocxNoteSummary[]
  readonly headerFooter: DocxHeaderFooterSummary
  readonly revisions: readonly DocxRevisionSummary[]
  readonly sections: readonly DocxSectionSummary[]
  readonly styles: readonly DocxStyleSummary[]
}

type Parsed = Awaited<ReturnType<typeof parseDocx>>
type NoteKind = 'footnote' | 'endnote'
type HfView = 'default' | 'first' | 'even'
type HfSlot = `${'header' | 'footer'}${'' | 'First' | 'Even'}`

type Loaded = {
  Editor: new (options: { element: HTMLElement; extensions: unknown }) => HeadlessEditor
  extensions: { editorExtensions: unknown }
  convert: {
    blocksToPmDoc: (blocks: Parsed['blocks'], sections: unknown) => unknown
    pmDocToSavePlan: (doc: unknown, blocks: Parsed['blocks']) => {
      saveBlocks: Parameters<typeof saveDocx>[1]
      saveBlockIndexByDocx: Map<number, number>
      chartPatches: Array<{ partPath: string; patch: Parameters<typeof patchChartPartXml>[1] }>
    }
  }
  protocol: {
    findNumId: (blocks: Parsed['blocks'], kind: 'bullet' | 'ordered') => string | null
    commentAnchors: (editor: HeadlessEditor) => Map<string, { blockIndex: number }>
  }
  tools: {
    executeTool: (...args: unknown[]) => { output: string; isError?: boolean } | Promise<{ output: string; isError?: boolean }>
    markDocSeen: (editor: HeadlessEditor) => void
  }
  comments: {
    nextCommentId: (comments: CommentInfo[]) => string
    addCommentToRange: (editor: HeadlessEditor, from: number, to: number, id: string) => boolean
    removeCommentFromDoc: (editor: HeadlessEditor, id: string) => void
    addReplyToCommentRange: (editor: HeadlessEditor, parentId: string, id: string) => boolean
  }
  hfText: {
    hfEditText: (value: HeaderFooter) => string
    applyHfText: (value: HeaderFooter | null, text: string) => HeaderFooter
  }
  noteOps: {
    noteAnchors: (doc: unknown) => Map<string, { num?: number; blockIndex?: number }>
    protectedNoteMarkBlock: (doc: unknown, xmlOf: (block: PmBlock) => string, kind: NoteKind, id: string) => unknown
  }
  pageSetup: {
    describeSection: (info: unknown, index: number, firstBlock: number, lastBlock: number) => {
      index: number
      firstBlock: number
      lastBlock: number
    }
    applyResolvedPageSetup: (xml: string, resolved: unknown) => string
    sectionBreakParagraphXml: (xml: string) => string
    sectionLine: (section: { index: number; firstBlock: number; lastBlock: number }) => string
  }
  revisionOps: {
    listRevisionEntries: (doc: unknown) => Array<{
      id: string
      type: string
      blockIndex: number
      text: string
      author: string
      date?: string
      change?: string
    }>
  }
  floating: {
    insertPosition: (editor: HeadlessEditor, after: unknown) => { pos: number; after: number } | { error: string }
    pictureNode: (input: Record<string, unknown>) => { node: unknown; widthPx: number; heightPx: number } | { error: string }
    resolveFloat: (value: unknown) => { float: unknown } | { error: string }
    resolvePictureWatermark: (
      input: Record<string, unknown>,
      image: { base64: string; mime: 'image/png' | 'image/jpeg' | 'image/gif'; widthPx: number; heightPx: number },
    ) => { spec: Watermark } | { error: string }
  }
  locale: { setModuleLang: (lang: 'en') => void }
}

type PmBlock = { type: { name: string }; attrs: Record<string, unknown> }

type HeadlessEditor = {
  commands: { setContent: (content: unknown) => void }
  destroy: () => void
  getJSON: () => unknown
  state: {
    doc: {
      childCount: number
      child: (index: number) => PmChild
      forEach: (fn: (block: PmChild, offset: number, index: number) => void) => void
    }
    tr: { setNodeMarkup: (pos: number, type: undefined, attrs: Record<string, unknown>) => unknown }
  }
  view: { dispatch: (tr: unknown) => void }
  storage: { listNumbering?: { styles?: Parsed['styles'] } }
  chain: () => { insertContentAt: (pos: number, node: unknown) => { run: () => void } }
}

type PmChild = {
  type: { name: string }
  attrs: Record<string, unknown>
  textContent: string
  nodeSize: number
}

type SideState = {
  hf: Partial<Record<HfSlot, HeaderFooter | null>>
  hfDirty: Set<HfSlot>
  titlePg: boolean
  evenOddHf: boolean
  titlePgDirty: boolean
  evenOddHfDirty: boolean
  comments: CommentInfo[]
  commentsDirty: boolean
  footnotes: NoteInfo[]
  endnotes: NoteInfo[]
  notesDirty: boolean
  sectPr: Map<number, string>
  styleUpserts: Map<string, StyleUpsert>
  watermark?: Watermark | null
  watermarkText: string | null
}

export type HeadlessDocument = {
  parsed: Parsed
  editor: HeadlessEditor
  numIds: { bullet: string | null; ordered: string | null }
  mods: Loaded
  side: SideState
}

let modules: Loaded | null = null

const clip = (value: string): string =>
  value.length <= PREVIEW_CHARS ? value : `${value.slice(0, PREVIEW_CHARS)}…`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const remoteImage = (value: unknown): boolean =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim())

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)

async function loadModules(): Promise<Loaded> {
  if (modules) return modules
  await ensureDom()
  const [
    core,
    extensions,
    convert,
    protocol,
    tools,
    locale,
    comments,
    hfText,
    noteOps,
    pageSetup,
    revisionOps,
    floating,
  ] = await Promise.all([
    import('@tiptap/core'),
    import('../vendor/apps/docs/src/renderer/editor/extensions'),
    import('../vendor/apps/docs/src/renderer/editor/convert'),
    import('../vendor/apps/docs/src/renderer/ai/protocol'),
    import('../vendor/apps/docs/src/renderer/ai/tools'),
    import('../vendor/apps/docs/src/renderer/i18n/locale'),
    import('../vendor/apps/docs/src/renderer/editor/comments'),
    import('../vendor/apps/docs/src/renderer/editor/hf-text'),
    import('../vendor/apps/docs/src/renderer/ai/note-ops'),
    import('../vendor/apps/docs/src/renderer/ai/page-setup'),
    import('../vendor/apps/docs/src/renderer/ai/revision-ops'),
    import('../vendor/apps/docs/src/renderer/ai/floating-ops'),
  ])
  locale.setModuleLang('en')
  modules = {
    Editor: core.Editor as Loaded['Editor'],
    extensions,
    convert,
    protocol,
    tools,
    comments,
    hfText,
    noteOps,
    pageSetup,
    revisionOps,
    floating,
    locale,
  }
  return modules
}

const hfFromPart = (part: HfPartInfo | null | undefined): HeaderFooter | null => {
  if (!part || (!part.text && !part.hasPageNumber && part.paras.length === 0 && !part.images?.length)) {
    return null
  }
  return {
    text: part.text,
    pageNumber: part.hasPageNumber,
    paras: part.paras.length > 0 ? part.paras : undefined,
  }
}

const sideStateOf = (parsed: Parsed): SideState => {
  const fallback = (kind: 'header' | 'footer'): HeaderFooter | null => {
    const text = kind === 'header' ? parsed.headerText : parsed.footerText
    const pageNumber = kind === 'header' ? parsed.headerHasPageNumber : parsed.footerHasPageNumber
    const paras = kind === 'header' ? parsed.headerParas : parsed.footerParas
    return text || pageNumber || paras?.length
      ? { text: text ?? '', pageNumber, paras: paras ?? undefined }
      : null
  }
  return {
    hf: {
      header: fallback('header'),
      footer: fallback('footer'),
      headerFirst: hfFromPart(parsed.headerFirst),
      footerFirst: hfFromPart(parsed.footerFirst),
      headerEven: hfFromPart(parsed.headerEven),
      footerEven: hfFromPart(parsed.footerEven),
    },
    hfDirty: new Set(),
    titlePg: parsed.titlePg ?? false,
    evenOddHf: parsed.evenAndOddHeaders ?? false,
    titlePgDirty: false,
    evenOddHfDirty: false,
    comments: [...parsed.comments],
    commentsDirty: false,
    footnotes: [...parsed.footnotes],
    endnotes: [...parsed.endnotes],
    notesDirty: false,
    sectPr: new Map(),
    styleUpserts: new Map(),
    watermarkText: parsed.watermarkText ?? null,
  }
}

const slotOf = (kind: 'header' | 'footer', view: HfView): HfSlot =>
  view === 'default' ? kind : `${kind}${view === 'first' ? 'First' : 'Even'}`

const protectedXml = (doc: HeadlessDocument, block: PmBlock): string => {
  if (typeof block.attrs.genXml === 'string') return block.attrs.genXml
  const docxIndex = block.attrs.docxIndex
  return (typeof docxIndex === 'number' ? doc.parsed.blocks[docxIndex]?.originalXml : null) ?? ''
}

const commentDate = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

const commentsAccess = (doc: HeadlessDocument) => {
  const { side } = doc
  return {
    list: () => side.comments,
    add: (range: { from: number; to: number }, text: string, meta: { author?: string; initials?: string }) => {
      const id = doc.mods.comments.nextCommentId(side.comments)
      if (!doc.mods.comments.addCommentToRange(doc.editor, range.from, range.to, id)) return null
      side.comments.push({
        id,
        author: meta.author ?? 'AI Assistant',
        ...(meta.initials ? { initials: meta.initials } : {}),
        date: commentDate(),
        text,
      })
      side.commentsDirty = true
      return id
    },
    remove: (id: string) => {
      const victims = new Set([id, ...side.comments.filter((comment) => comment.parentId === id).map((comment) => comment.id)])
      if (!side.comments.some((comment) => comment.id === id)) return false
      for (const victim of victims) doc.mods.comments.removeCommentFromDoc(doc.editor, victim)
      side.comments = side.comments.filter((comment) => !victims.has(comment.id))
      side.commentsDirty = true
      return true
    },
    reply: (parentId: string, text: string) => {
      const id = doc.mods.comments.nextCommentId(side.comments)
      if (!doc.mods.comments.addReplyToCommentRange(doc.editor, parentId, id)) return false
      side.comments.push({ id, author: 'AI Assistant', date: commentDate(), text, parentId })
      side.commentsDirty = true
      return true
    },
    resolve: (id: string) => {
      if (!side.comments.some((comment) => comment.id === id)) return false
      side.comments = side.comments.map((comment) =>
        comment.id === id || comment.parentId === id ? { ...comment, done: true } : comment)
      side.commentsDirty = true
      return true
    },
  }
}

const notesAccess = (doc: HeadlessDocument) => {
  const { side } = doc
  const listOf = (kind: NoteKind) => (kind === 'footnote' ? side.footnotes : side.endnotes)
  const setList = (kind: NoteKind, next: NoteInfo[]) => {
    if (kind === 'footnote') side.footnotes = next
    else side.endnotes = next
    side.notesDirty = true
  }
  return {
    list: listOf,
    add: (kind: NoteKind, text: string) => {
      const id = nextNoteId(listOf(kind))
      setList(kind, [...listOf(kind), { id, text }])
      return id
    },
    remove: (kind: NoteKind, id: string) => {
      if (!listOf(kind).some((note) => note.id === id)) return false
      setList(kind, listOf(kind).filter((note) => note.id !== id))
      return true
    },
    replace: (kind: NoteKind, id: string, next: NoteInfo) => {
      if (!listOf(kind).some((note) => note.id === id)) return false
      setList(kind, listOf(kind).map((note) => (note.id === id ? next : note)))
      return true
    },
    protectedMarkBlock: (kind: NoteKind, id: string) =>
      doc.mods.noteOps.protectedNoteMarkBlock(doc.editor.state.doc, (block) => protectedXml(doc, block), kind, id),
  }
}

const headerFooterAccess = (doc: HeadlessDocument) => {
  const { side } = doc
  return {
    read: () => describe(doc).headerFooter,
    set: (kind: 'header' | 'footer', view: HfView, text: string) => {
      if (view === 'first' && !side.titlePg) {
        side.titlePg = true
        side.titlePgDirty = true
      }
      if (view === 'even' && !side.evenOddHf) {
        side.evenOddHf = true
        side.evenOddHfDirty = true
      }
      const slot = slotOf(kind, view)
      side.hf[slot] = doc.mods.hfText.applyHfText(side.hf[slot] ?? null, text)
      side.hfDirty.add(slot)
      return null
    },
  }
}

const toolInput = (doc: HeadlessDocument, name: string, op: Record<string, unknown>): Record<string, unknown> => {
  const input = { ...op }
  delete input.op
  if (name === 'insert_content' && input.afterBlockIndex === undefined) {
    input.afterBlockIndex = doc.editor.state.doc.childCount - 1
  }
  if (name === 'set_text') {
    return {
      startBlockIndex: input.block,
      endBlockIndex: input.block,
      html: `<p>${escapeHtml(String(input.text))}</p>`,
    }
  }
  return input
}

/** Refuse names that must never reach the editor. Structural set_text checks happen here too. */
export const validateOps = (ops: readonly unknown[]): void => {
  ops.forEach((value, index) => {
    if (!isRecord(value)) {
      throw new DocxHeadlessError(index, `op ${index} rejected: expected an object`)
    }
    const name = typeof value.op === 'string' ? value.op : ''
    if (!ALLOWED.has(name)) {
      throw new DocxHeadlessError(
        index,
        `op ${index} (${name || '?'}) rejected: ${name || 'that operation'} is not available`
      )
    }
    if (name === 'set_text') {
      if (typeof value.block !== 'number' || !Number.isInteger(value.block) || value.block < 0) {
        throw new DocxHeadlessError(index, `op ${index} (set_text) rejected: block must be a non-negative integer`)
      }
      if (typeof value.text !== 'string') {
        throw new DocxHeadlessError(index, `op ${index} (set_text) rejected: text must be a string`)
      }
    }
    if ((name === 'insert_image' || name === 'insert_picture') && remoteImage(value.url)) {
      throw new DocxHeadlessError(index, `op ${index} (${name}) rejected: remote images are not built in`)
    }
    if (name === 'set_watermark' && remoteImage(value.image)) {
      throw new DocxHeadlessError(index, `op ${index} (set_watermark) rejected: remote images are not built in`)
    }
  })
}

export async function open(bytes: Uint8Array): Promise<HeadlessDocument> {
  const mods = await loadModules()
  const parsed = await parseDocx(bytes)
  const editor = new mods.Editor({
    element: document.createElement('div'),
    extensions: mods.extensions.editorExtensions,
  })
  editor.commands.setContent(mods.convert.blocksToPmDoc(parsed.blocks, readSections(parsed)))
  if (editor.storage.listNumbering) editor.storage.listNumbering.styles = parsed.styles
  return {
    parsed,
    editor,
    numIds: {
      bullet: mods.protocol.findNumId(parsed.blocks, 'bullet') ?? BLANK_BULLET_NUM_ID,
      ordered: mods.protocol.findNumId(parsed.blocks, 'ordered') ?? BLANK_ORDERED_NUM_ID,
    },
    mods,
    side: sideStateOf(parsed),
  }
}

export function describe(doc: HeadlessDocument): DocxDescription {
  const blocks: DocxBlockSummary[] = []
  const root = doc.editor.state.doc
  for (let index = 0; index < root.childCount; index += 1) {
    const node = root.child(index)
    const blockType = typeof node.attrs.blockType === 'string' ? node.attrs.blockType : ''
    const previewText = typeof node.attrs.previewText === 'string' ? node.attrs.previewText : ''
    const type = blockType === 'image'
      ? 'image'
      : blockType === 'chart' || node.attrs.chartDisplay
        ? 'chart'
        : node.type.name.replace(/^doc/, '').toLowerCase()
    blocks.push({
      index,
      type,
      preview: clip(node.textContent || previewText),
    })
  }
  const anchors = doc.mods.protocol.commentAnchors(doc.editor)
  const comments = doc.side.comments.map((comment) => {
    const anchor = anchors.get(comment.parentId ?? comment.id)
    return {
      id: comment.id,
      text: clip(comment.text),
      ...(comment.author ? { author: comment.author } : {}),
      ...(comment.parentId ? { parentId: comment.parentId } : {}),
      ...(anchor ? { blockIndex: anchor.blockIndex } : {}),
    }
  })
  const noteAnchors = doc.mods.noteOps.noteAnchors(doc.editor.state.doc)
  const notes = (kind: NoteKind, items: readonly NoteInfo[]): DocxNoteSummary[] =>
    items.map((note) => {
      const anchor = noteAnchors.get(`${kind}:${note.id}`)
      return {
        kind,
        id: note.id,
        text: clip(note.text),
        ...(anchor?.blockIndex !== undefined ? { blockIndex: anchor.blockIndex } : {}),
      }
    })
  const textOf = (slot: HfSlot): string => {
    const value = doc.side.hf[slot]
    return value ? clip(doc.mods.hfText.hfEditText(value)) : ''
  }
  const revisions = doc.mods.revisionOps.listRevisionEntries(doc.editor.state.doc).map((revision) => ({
    id: revision.id,
    type: revision.type,
    blockIndex: revision.blockIndex,
    text: clip(revision.text),
    author: revision.author,
    ...(revision.date ? { date: revision.date } : {}),
    ...(revision.change ? { change: clip(revision.change) } : {}),
  }))
  const sections = listSections(doc).map((section) => ({
    index: section.index,
    firstBlock: section.firstBlock,
    lastBlock: section.lastBlock,
    summary: doc.mods.pageSetup.sectionLine(section),
  }))
  return {
    blocks,
    comments,
    notes: [...notes('footnote', doc.side.footnotes), ...notes('endnote', doc.side.endnotes)],
    headerFooter: {
      header: textOf('header'),
      footer: textOf('footer'),
      headerFirst: doc.side.titlePg ? textOf('headerFirst') : null,
      footerFirst: doc.side.titlePg ? textOf('footerFirst') : null,
      headerEven: doc.side.evenOddHf ? textOf('headerEven') : null,
      footerEven: doc.side.evenOddHf ? textOf('footerEven') : null,
    },
    revisions,
    sections,
    styles: listStyles(doc),
  }
}

export async function apply(doc: HeadlessDocument, ops: readonly unknown[]): Promise<void> {
  validateOps(ops)
  const comments = commentsAccess(doc)
  const notes = notesAccess(doc)
  const headerFooter = headerFooterAccess(doc)
  const extras = docExtras(doc)
  for (const [index, value] of ops.entries()) {
    const op = value as Record<string, unknown>
    const name = String(op.op)
    if (name === 'insert_image' || name === 'insert_picture') {
      const inserted = await insertLocalImage(doc, op, name === 'insert_picture')
      if (inserted) throw new DocxHeadlessError(index, `op ${index} (${name}) rejected: ${inserted}`)
      continue
    }
    if (name === 'set_watermark' && typeof op.image === 'string') {
      const marked = await setPictureWatermark(doc, op)
      if (marked) throw new DocxHeadlessError(index, `op ${index} (set_watermark) rejected: ${marked}`)
      continue
    }
    const call = BLOCK_OPS.has(name)
      ? { id: `lyra-${index}`, name: 'apply_ops', input: { ops: [op] } }
      : {
        id: `lyra-${index}`,
        name: name === 'set_text' ? 'replace_blocks' : name,
        input: toolInput(doc, name, op),
      }
    const exec = await doc.mods.tools.executeTool(
      doc.editor,
      call,
      doc.numIds,
      undefined,
      undefined,
      null,
      comments,
      headerFooter,
      undefined,
      pageSetupAccess(doc),
      extras,
      notes,
    )
    if (exec.isError || /^No matching blocks/i.test(exec.output)) {
      throw new DocxHeadlessError(index, `op ${index} (${name}) rejected: ${exec.output}`)
    }
  }
}

export async function save(doc: HeadlessDocument): Promise<Uint8Array> {
  const plan = doc.mods.convert.pmDocToSavePlan(doc.editor.getJSON(), doc.parsed.blocks)
  const sectionEdits = applySectionEdits(doc, {
    saveBlocks: [...plan.saveBlocks],
    saveBlockIndexByDocx: plan.saveBlockIndexByDocx,
  })
  const { side } = doc
  const hf = (slot: HfSlot): HeaderFooter | undefined =>
    side.hfDirty.has(slot) ? (side.hf[slot] ?? undefined) : undefined
  const options: SaveOptions = {
    ...sectionEdits.options,
    header: hf('header'),
    footer: hf('footer'),
    headerFirst: hf('headerFirst'),
    footerFirst: hf('footerFirst'),
    headerEven: hf('headerEven'),
    footerEven: hf('footerEven'),
    titlePg: side.titlePgDirty ? side.titlePg : undefined,
    evenAndOddHeaders: side.evenOddHfDirty ? side.evenOddHf : undefined,
    comments: side.commentsDirty ? side.comments : undefined,
    styleUpserts: side.styleUpserts.size > 0 ? [...side.styleUpserts.values()] : undefined,
    watermark: side.watermark,
    footnotes: side.notesDirty ? side.footnotes : undefined,
    endnotes: side.notesDirty ? side.endnotes : undefined,
    ...(await chartPartPatches(doc, plan.chartPatches ?? [])),
  }
  return saveDocx(doc.parsed, sectionEdits.saveBlocks, options)
}

const listStyles = (doc: HeadlessDocument): DocxStyleSummary[] => {
  const out = new Map<string, DocxStyleSummary>()
  for (const style of doc.parsed.styles.values()) {
    if (style.linkedCharShell) continue
    out.set(style.styleId, {
      styleId: style.styleId,
      name: style.name,
      type: style.type,
      ...(style.headingLevel ? { headingLevel: style.headingLevel } : {}),
    })
  }
  for (const up of doc.side.styleUpserts.values()) {
    const current = out.get(up.styleId)
    const headingLevel = pendingHeadingLevel(
      up.styleId,
      (id) => doc.side.styleUpserts.get(id),
      (id) => doc.parsed.styles.get(id),
    )
    out.set(up.styleId, {
      styleId: up.styleId,
      name: up.name ?? current?.name ?? up.styleId,
      type: current?.type ?? up.type ?? 'paragraph',
      ...(headingLevel ? { headingLevel } : {}),
    })
  }
  return [...out.values()]
}

const docExtras = (doc: HeadlessDocument) => ({
  styles: {
    list: () => listStyles(doc).map((style) => ({
      ...style,
      ...(doc.side.styleUpserts.has(style.styleId) ? { pending: true } : {}),
    })),
    upsert: (up: StyleUpsert) => {
      const prev = doc.side.styleUpserts.get(up.styleId)
      doc.side.styleUpserts.set(up.styleId, prev
        ? {
          ...prev,
          ...up,
          pPr: up.pPr || prev.pPr ? { ...prev.pPr, ...up.pPr } : undefined,
          rPr: up.rPr || prev.rPr ? { ...prev.rPr, ...up.rPr } : undefined,
        }
        : up)
      return null
    },
  },
  watermark: {
    current: () => doc.side.watermarkText,
    set: (spec: Watermark | null) => {
      doc.side.watermark = spec
      return null
    },
  },
})

const insertLocalImage = async (
  doc: HeadlessDocument,
  op: Record<string, unknown>,
  picture: boolean,
): Promise<string | null> => {
  const url = typeof op.url === 'string' ? op.url.trim() : ''
  if (!url) return 'url must be a local path or a data: URL'
  const source = await readLocalImage(url)
  if ('error' in source) return source.error
  const at = doc.mods.floating.insertPosition(doc.editor, op.afterBlockIndex)
  if ('error' in at) return at.error
  let float: unknown
  if (picture && op.float !== undefined) {
    const resolved = doc.mods.floating.resolveFloat(op.float)
    if ('error' in resolved) return resolved.error
    float = resolved.float
  }
  const built = doc.mods.floating.pictureNode({
    base64: Buffer.from(source.bytes).toString('base64'),
    mime: source.mime,
    naturalWidth: source.width,
    naturalHeight: source.height,
    label: picture ? 'Picture' : 'Image',
    ...(picture
      ? {
        width: op.width,
        height: op.height,
        float,
        ...(typeof op.altText === 'string' ? { altText: op.altText } : {}),
      }
      : { width: `${Math.min(source.width, Number(op.maxWidthPx) || 480)}px` }),
  })
  if ('error' in built) return built.error
  doc.editor.chain().insertContentAt(at.pos, built.node).run()
  doc.mods.tools.markDocSeen(doc.editor)
  return null
}

const setPictureWatermark = async (
  doc: HeadlessDocument,
  op: Record<string, unknown>,
): Promise<string | null> => {
  const url = typeof op.image === 'string' ? op.image.trim() : ''
  if (!url) return 'image must be a local path or a data: URL'
  const source = await readLocalImage(url)
  if ('error' in source) return source.error
  const resolved = doc.mods.floating.resolvePictureWatermark(op, {
    base64: Buffer.from(source.bytes).toString('base64'),
    mime: source.mime,
    widthPx: source.width,
    heightPx: source.height,
  })
  if ('error' in resolved) return resolved.error
  doc.side.watermark = resolved.spec
  return null
}

const chartPartPatches = async (
  doc: HeadlessDocument,
  patches: Array<{ partPath: string; patch: Parameters<typeof patchChartPartXml>[1] }>,
): Promise<Pick<SaveOptions, 'partXml' | 'partBinary'>> => {
  const partXml: Record<string, string> = {}
  const partBinary: Record<string, string> = {}
  const original = doc.parsed.internal.originalBytes
  for (const { partPath, patch } of patches) {
    const part = doc.parsed.extras.chartParts[partPath]
    if (!part) continue
    const patched = patchChartPartXml(part, patch)
    partXml[partPath] = patched
    const workbookPath = await findChartWorkbookPath(original, partPath)
    const workbook = workbookPath ? await readDocxPartBase64(original, workbookPath) : null
    const display = workbook ? parseChartPartXml(patched, partPath) : null
    if (workbookPath && workbook && display) {
      const updated = await patchChartWorkbookXlsxBase64(
        workbook,
        display.categories,
        display.series.map((series, index) => ({
          name: series.name ?? `Series${index + 1}`,
          values: series.values as (number | null)[],
        })),
      )
      if (updated) partBinary[workbookPath] = updated
    }
  }
  return {
    ...(Object.keys(partXml).length > 0 ? { partXml } : {}),
    ...(Object.keys(partBinary).length > 0 ? { partBinary } : {}),
  }
}

export function close(doc: HeadlessDocument): void {
  doc.editor.destroy()
}
