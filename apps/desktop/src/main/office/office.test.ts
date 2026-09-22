import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync, crc32 } from "node:zlib";

import { describe, expect, test } from "vitest";

import { assertOfficeEditPath } from "../../shared/office-documents";
import { OfficeDocxError, applyDocxBytes, applyDocxFile, readDocxBytes } from "./docx";
import { previewOfficeFile } from "./preview";
import { OfficePptxError, applyPptxBytes, applyPptxFile, readPptxBytes } from "./pptx";
import { OfficeXlsxError, applyXlsxBytes, applyXlsxFile, readXlsxBytes } from "./xlsx";

const unzipEntry = (archive: Uint8Array, name: string): string => {
  const buf = Buffer.from(archive);
  let offset = 0;
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const entryName = buf.subarray(offset + 30, offset + 30 + nameLength).toString();
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (entryName === name) {
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`missing zip entry ${name}`);
};

const zip = (files: readonly { readonly name: string; readonly data: Buffer }[]): Uint8Array => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const compressed = deflateRawSync(file.data);
    const checksum = crc32(file.data);
    const local = Buffer.alloc(30 + name.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.length);
    locals.push(local);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralDirectory, end]));
};

const xml = (value: string): Buffer => Buffer.from(value);

const helloDocx = (): Uint8Array => zip([
  {
    name: "[Content_Types].xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  },
  {
    name: "_rels/.rels",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  },
  {
    name: "word/_rels/document.xml.rels",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
  },
  {
    name: "word/document.xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`)
  }
]);

describe("office docx", () => {
  test("reads the paragraph block index and preview", async () => {
    const read = await readDocxBytes(helloDocx());
    expect(read.blocks).toEqual([
      expect.objectContaining({ index: 0, preview: "Hello" })
    ]);
  });

  test("replaces paragraph text and rejects an invalid batch without writing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-office-docx-"));
    const filePath = join(directory, "note.docx");
    const original = Buffer.from(helloDocx());
    await writeFile(filePath, original);
    const before = await stat(filePath);

    await expect(applyDocxFile(filePath, [{ op: "set_text", block: 9, text: "Nope" }]))
      .rejects.toBeInstanceOf(OfficeDocxError);
    expect(Buffer.from(await readFile(filePath))).toEqual(original);
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);

    const applied = await applyDocxFile(filePath, [{ op: "set_text", block: 0, text: "Updated" }]);
    expect(applied).toEqual({ applied: 1, written: true });
    const next = await readDocxBytes(new Uint8Array(await readFile(filePath)));
    expect(next.blocks[0]?.preview).toBe("Updated");
    expect(await applyDocxBytes(helloDocx(), [])).toMatchObject({ applied: 0 });
  });
});

describe("office preview", () => {
  test("returns the original bytes for every preview format", async () => {
    const cases = [
      ["/tmp/note.pdf", "pdf", "note.pdf"],
      ["/tmp/brief.docx", "docx", "brief.docx"],
      ["/tmp/book.xlsx", "xlsx", "book.xlsx"],
      ["/tmp/deck.pptx", "pptx", "deck.pptx"]
    ] as const;
    for (const [path, format, title] of cases) {
      const preview = await previewOfficeFile(path, {
        readFile: async () => new Uint8Array([1, 2, 3])
      });
      expect(preview).toMatchObject({ format, title });
      expect(Array.from(preview.bytes)).toEqual([1, 2, 3]);
    }
  });

  test("rejects a file that is not an office document", async () => {
    await expect(previewOfficeFile("/tmp/note.txt")).rejects.toMatchObject({ code: "unsupported" });
  });

  test("rejects pdf edits and accepts docx, xlsx, and pptx", () => {
    expect(() => assertOfficeEditPath("/tmp/note.pdf", "read")).toThrow(/pdf/);
    expect(assertOfficeEditPath("/tmp/book.xlsx", "apply")).toBe("xlsx");
    expect(assertOfficeEditPath("/tmp/deck.pptx", "read")).toBe("pptx");
    expect(assertOfficeEditPath("/tmp/note.docx", "apply")).toBe("docx");
  });
});

const helloSheet = (): Uint8Array => zip([
  {
    name: "[Content_Types].xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`)
  },
  {
    name: "_rels/.rels",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
  },
  {
    name: "xl/_rels/workbook.xml.rels",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`)
  },
  {
    name: "xl/workbook.xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`)
  },
  {
    name: "xl/worksheets/sheet1.xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c><c r="B1"><v>42</v></c></row>
  </sheetData>
</worksheet>`)
  }
]);

const helloDeck = (): Uint8Array => zip([
  {
    name: "[Content_Types].xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`)
  },
  {
    name: "_rels/.rels",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`)
  },
  {
    name: "ppt/_rels/presentation.xml.rels",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`)
  },
  {
    name: "ppt/presentation.xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`)
  },
  {
    name: "ppt/slides/slide1.xml",
    data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hello slide</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`)
  }
]);

describe("office sheet and slide edits", () => {
  test("reads cells, writes a value, and stores a formula without evaluating it", async () => {
    const read = await readXlsxBytes(helloSheet());
    expect(read.truncated).toBe(false);
    expect(read.sheets[0]?.cells).toEqual([
      { address: "A1", value: "Hello" },
      { address: "B1", value: 42 }
    ]);

    const valued = await applyXlsxBytes(helloSheet(), [
      { op: "set_cell", cell: "B2", value: "Updated" }
    ]);
    expect(valued.applied).toBe(1);
    const next = await readXlsxBytes(valued.bytes);
    expect(next.sheets[0]?.cells).toContainEqual({ address: "B2", value: "Updated" });

    const formulated = await applyXlsxBytes(helloSheet(), [
      { op: "set_formula", cell: "C2", formula: "SUM(A1:A2)" }
    ]);
    const formulaCell = (await readXlsxBytes(formulated.bytes)).sheets[0]?.cells.find((cell) => cell.address === "C2");
    expect(formulaCell?.formula).toBe("=SUM(A1:A2)");
    expect(formulaCell?.value).toBeNull();
  });

  test("rejects an invalid cell batch without writing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-office-xlsx-"));
    const filePath = join(directory, "book.xlsx");
    const original = Buffer.from(helloSheet());
    await writeFile(filePath, original);
    const before = await stat(filePath);
    await expect(applyXlsxFile(filePath, [
      { op: "set_cell", cell: "B2", value: "Ok" },
      { op: "set_cell", cell: "nope", value: "Bad" }
    ])).rejects.toBeInstanceOf(OfficeXlsxError);
    expect(Buffer.from(await readFile(filePath))).toEqual(original);
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
  });

  test("writes a range, clears it, merges cells, and adds a sheet", async () => {
    const ranged = await applyXlsxBytes(helloSheet(), [
      { op: "set_range", start: "A2", values: [["Left", 7], ["Right", 8]] }
    ]);
    const rangedRead = await readXlsxBytes(ranged.bytes);
    expect(rangedRead.sheets[0]?.cells).toEqual(expect.arrayContaining([
      { address: "A2", value: "Left" },
      { address: "B2", value: 7 },
      { address: "A3", value: "Right" },
      { address: "B3", value: 8 }
    ]));

    const cleared = await applyXlsxBytes(ranged.bytes, [
      { op: "clear_range", range: "B1:B1" }
    ]);
    expect((await readXlsxBytes(cleared.bytes)).sheets[0]?.cells.some((cell) => cell.address === "B1")).toBe(false);

    const merged = await applyXlsxBytes(helloSheet(), [
      { op: "merge_cells", range: "A1:B1" }
    ]);
    const sheetXml = unzipEntry(merged.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain("A1:B1");

    const added = await applyXlsxBytes(helloSheet(), [
      { op: "add_sheet", name: "Notes" }
    ]);
    expect((await readXlsxBytes(added.bytes)).sheets.map((sheet) => sheet.name)).toEqual(["Sheet1", "Notes"]);
  });

  test("reads a slide element and replaces its text", async () => {
    const read = await readPptxBytes(helloDeck());
    const element = read.slides[0]?.elements.find((item) => item.preview === "Hello slide");
    expect(element).toMatchObject({ type: "shape", preview: "Hello slide" });
    expect(element?.id.startsWith("e_")).toBe(true);

    const applied = await applyPptxBytes(helloDeck(), [
      { op: "set_text", slide: 0, element: element?.id, text: "Updated" }
    ]);
    expect(applied.applied).toBe(1);
    const next = await readPptxBytes(applied.bytes);
    expect(next.slides[0]?.elements.some((item) => item.preview === "Updated")).toBe(true);
  });

  test("deletes a slide element through the engine operation", async () => {
    const read = await readPptxBytes(helloDeck());
    const element = read.slides[0]?.elements.find((item) => item.preview === "Hello slide");
    const applied = await applyPptxBytes(helloDeck(), [
      { op: "deleteElement", target: { slide: 0, el: element?.id } }
    ]);
    expect(applied.applied).toBe(1);
    const next = await readPptxBytes(applied.bytes);
    expect(next.slides[0]?.elements.some((item) => item.preview === "Hello slide")).toBe(false);
  });

  test("rejects an unknown slide element without writing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-office-pptx-"));
    const filePath = join(directory, "deck.pptx");
    const original = Buffer.from(helloDeck());
    await writeFile(filePath, original);
    const before = await stat(filePath);
    await expect(applyPptxFile(filePath, [
      { op: "set_text", slide: 0, element: "e_missing", text: "Nope" }
    ])).rejects.toBeInstanceOf(OfficePptxError);
    expect(Buffer.from(await readFile(filePath))).toEqual(original);
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
  });

  test("rejects an unknown slide operation without writing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-office-pptx-op-"));
    const filePath = join(directory, "deck.pptx");
    const original = Buffer.from(helloDeck());
    await writeFile(filePath, original);
    const before = await stat(filePath);
    await expect(applyPptxFile(filePath, [
      { op: "not_a_real_op", target: { slide: 0, el: "e_2" } }
    ])).rejects.toThrow(/unknown op/);
    expect(Buffer.from(await readFile(filePath))).toEqual(original);
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
  });
});
