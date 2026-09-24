import {
  applySectionStartType,
  sectionFromSectPr,
  type SaveBlock,
  type SaveOptions,
  type SectionInfo,
} from '@genoffice/docx-engine'

const SECT_PR = /<w:sectPr[^>]*\/>|<w:sectPr[\s\S]*?<\/w:sectPr>/

type SectionNode = {
  type: { name: string }
  attrs: Record<string, unknown>
  nodeSize: number
}

type SectionEditor = {
  state: {
    doc: {
      childCount: number
      child: (index: number) => SectionNode
      forEach: (fn: (node: SectionNode, offset: number, index: number) => void) => void
    }
    tr: { setNodeMarkup: (pos: number, type: undefined, attrs: Record<string, unknown>) => unknown }
  }
  view: { dispatch: (tr: unknown) => void }
  chain: () => { insertContentAt: (pos: number, node: unknown) => { run: () => void } }
}

type SectionSummary = {
  index: number
  firstBlock: number
  lastBlock: number
}

export type SectionHost = {
  parsed: {
    blocks: readonly {
      docxIndex: number | null
      originalXml: string | null
      hidden?: boolean
    }[]
    gutterAtTop?: boolean
  }
  editor: SectionEditor
  mods: {
    pageSetup: {
      describeSection: (
        info: SectionInfo,
        index: number,
        firstBlock: number,
        lastBlock: number
      ) => SectionSummary
      applyResolvedPageSetup: (xml: string, resolved: unknown) => string
      sectionBreakParagraphXml: (xml: string) => string
      sectionLine: (section: SectionSummary) => string
    }
    tools: { markDocSeen: (editor: SectionEditor) => void }
  }
  side: {
    sectPr: Map<number, string>
    titlePg: boolean
    titlePgDirty: boolean
  }
}

type Boundary = {
  kind: 'original' | 'generated' | 'trailing'
  pmIndex: number
  docxIndex?: number
  xml: string
}

const boundaries = (doc: SectionHost): Boundary[] => {
  const { parsed, side } = doc
  const byDocx = new Map<number, string>()
  for (const block of parsed.blocks) {
    if (block.docxIndex !== null && block.originalXml?.includes('<w:sectPr')) {
      const match = SECT_PR.exec(block.originalXml)
      if (match) byDocx.set(block.docxIndex, match[0])
    }
  }
  const out: Boundary[] = []
  const root = doc.editor.state.doc
  root.forEach((node, _offset, index) => {
    const genXml = node.attrs.genXml
    if (node.type.name === 'docProtected' && typeof genXml === 'string') {
      const match = SECT_PR.exec(genXml)
      if (match) out.push({ kind: 'generated', pmIndex: index, xml: match[0] })
      return
    }
    const docxIndex = node.attrs.docxIndex
    if (typeof docxIndex === 'number' && byDocx.has(docxIndex)) {
      out.push({
        kind: 'original',
        pmIndex: index,
        docxIndex,
        xml: side.sectPr.get(docxIndex) ?? byDocx.get(docxIndex)!,
      })
    }
  })
  const trailing = parsed.blocks.find((block) => block.hidden && block.originalXml?.includes('<w:sectPr'))
  if (trailing && trailing.docxIndex !== null) {
    const original = SECT_PR.exec(trailing.originalXml ?? '')?.[0] ?? ''
    out.push({
      kind: 'trailing',
      pmIndex: root.childCount,
      docxIndex: trailing.docxIndex,
      xml: side.sectPr.get(trailing.docxIndex) ?? original,
    })
  }
  return out
}

const sections = (doc: SectionHost): { info: SectionInfo; boundary: Boundary }[] => {
  const count = doc.editor.state.doc.childCount
  const out: { info: SectionInfo; boundary: Boundary }[] = []
  let first = 0
  for (const boundary of boundaries(doc)) {
    const last = boundary.kind === 'trailing' ? Math.max(count - 1, first) : boundary.pmIndex
    out.push({
      info: sectionFromSectPr(boundary.xml, first, last, doc.parsed.gutterAtTop),
      boundary,
    })
    first = last + 1
  }
  return out
}

export const listSections = (doc: SectionHost): SectionSummary[] =>
  sections(doc).map(({ info }, index) =>
    doc.mods.pageSetup.describeSection(info, index, info.firstBlockIndex, info.lastBlockIndex))

const store = (doc: SectionHost, boundary: Boundary, xml: string): void => {
  if (boundary.kind === 'generated') {
    const root = doc.editor.state.doc
    const node = root.child(boundary.pmIndex)
    let pos = 0
    for (let index = 0; index < boundary.pmIndex; index += 1) pos += root.child(index).nodeSize
    const genXml = String(node.attrs.genXml).replace(boundary.xml, xml)
    doc.editor.view.dispatch(
      doc.editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, genXml })
    )
    doc.mods.tools.markDocSeen(doc.editor)
    return
  }
  doc.side.sectPr.set(boundary.docxIndex!, xml)
}

export const pageSetupAccess = (doc: SectionHost) => {
  const { pageSetup } = doc.mods
  return {
    list: () => listSections(doc),
    current: (index: number) => sections(doc)[index]?.info,
    set: (index: number, resolved: unknown) => {
      const section = sections(doc)[index]
      if (!section) return `section ${index} does not exist`
      store(doc, section.boundary, pageSetup.applyResolvedPageSetup(section.boundary.xml, resolved))
      if (section.boundary.kind === 'trailing' && resolved && typeof resolved === 'object' && 'titlePg' in resolved && typeof resolved.titlePg === 'boolean') {
        doc.side.titlePg = resolved.titlePg
        doc.side.titlePgDirty = true
      }
      return null
    },
    insertBreak: (type: string, afterBlockIndex: number) => {
      const all = sections(doc)
      if (all.length === 0) return 'the document has no section properties to copy'
      const owner = all.find((section) => Math.max(afterBlockIndex, 0) <= section.info.lastBlockIndex) ?? all[all.length - 1]!
      const root = doc.editor.state.doc
      let pos = 0
      for (let index = 0; index <= afterBlockIndex && index < root.childCount; index += 1) {
        pos += root.child(index).nodeSize
      }
      doc.editor.chain().insertContentAt(pos, {
        type: 'docProtected',
        attrs: {
          docxIndex: null,
          blockType: 'passthrough',
          label: 'Section break paragraph',
          previewText: '',
          genXml: pageSetup.sectionBreakParagraphXml(owner.boundary.xml),
        },
      }).run()
      const shifted = owner.boundary.kind === 'generated' && owner.boundary.pmIndex > afterBlockIndex
        ? { ...owner.boundary, pmIndex: owner.boundary.pmIndex + 1 }
        : owner.boundary
      store(doc, shifted, applySectionStartType(
        owner.boundary.xml,
        type as 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn'
      ))
      doc.mods.tools.markDocSeen(doc.editor)
      return null
    },
  }
}

type SavePlanLike = {
  saveBlocks: SaveBlock[]
  saveBlockIndexByDocx: Map<number, number>
}

export const applySectionEdits = (
  doc: SectionHost,
  plan: SavePlanLike
): { saveBlocks: SaveBlock[]; options: Partial<SaveOptions> } => {
  const { parsed, side } = doc
  if (side.sectPr.size === 0) return { saveBlocks: plan.saveBlocks, options: {} }
  const trailing = parsed.blocks.find((block) => block.hidden && block.originalXml?.includes('<w:sectPr'))
  const options: Partial<SaveOptions> = {}
  const out = [...plan.saveBlocks]
  for (const [docxIndex, xml] of side.sectPr) {
    if (trailing && docxIndex === trailing.docxIndex) {
      options.trailingSectPr = xml
      continue
    }
    const at = plan.saveBlockIndexByDocx.get(docxIndex)
    const block = at === undefined ? undefined : out[at]
    if (!block) continue
    if (block.kind === 'original') {
      const source = parsed.blocks.find((item) => item.docxIndex === docxIndex)
      if (source?.originalXml) {
        out[at!] = { ...block, kind: 'xml', xml: source.originalXml.replace(SECT_PR, xml), docxIndex }
      }
    } else if (block.kind === 'generated' && block.block.rawPPr && SECT_PR.test(block.block.rawPPr)) {
      out[at!] = { ...block, block: { ...block.block, rawPPr: block.block.rawPPr.replace(SECT_PR, xml) } }
    } else if (block.kind === 'xml' && block.xml && SECT_PR.test(block.xml)) {
      out[at!] = { ...block, xml: block.xml.replace(SECT_PR, xml) }
    }
  }
  return { saveBlocks: out, options }
}
