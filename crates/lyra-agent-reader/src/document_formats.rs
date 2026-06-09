//! Non-HTML document/image adapters for the reader pipeline.

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::process::Command;
use std::time::{Duration, Instant};

use regex::Regex;
use zip::ZipArchive;

use crate::errors::ReaderError;
use crate::types::{ExtractionInfo, ReaderMetadata, ReaderWarning, WarningCode};

const MAX_XLSX_ROWS: usize = 1_000;
const MAX_XLSX_COLUMNS: usize = 80;

pub struct RenderedDocument {
    pub markdown: String,
    pub metadata: ReaderMetadata,
    pub info: ExtractionInfo,
    pub warnings: Vec<ReaderWarning>,
}

pub fn render_pdf(
    bytes: &[u8],
    mime: Option<&str>,
    url: Option<&str>,
) -> Result<RenderedDocument, ReaderError> {
    let result = lyra_docs_core::read_document_text(lyra_docs_core::DocumentReadRequest {
        bytes: bytes.to_vec(),
        mime_hint: mime.map(str::to_string),
        url_hint: url.map(str::to_string),
        scope: lyra_docs_core::DocumentReadScope::Full,
        page_start: None,
        page_end: None,
        visible_pages: Vec::new(),
        current_page: None,
        max_chars: Some(1_000_000),
        cursor: None,
    })
    .map_err(|error| ReaderError::Parse(format!("pdf parse failed: {error}")))?;

    let mut warnings = Vec::new();
    if result.text.trim().is_empty() {
        warnings.push(ReaderWarning {
            code: WarningCode::OcrRecommended,
            message: "PDF contains no extractable text; OCR may be required".to_string(),
        });
    }

    let mut metadata = ReaderMetadata::default();
    metadata.title = url.and_then(title_from_url);
    let mut markdown = String::new();
    markdown.push_str("# PDF Document\n\n");
    if let Some(page_count) = result.page_count {
        markdown.push_str(&format!("Pages: {page_count}\n\n"));
    }
    if result.text.trim().is_empty() {
        markdown.push_str("_No extractable text found._");
    } else {
        markdown.push_str(&pdf_markdown_by_page(bytes, mime, url, &result)?);
    }

    Ok(RenderedDocument {
        markdown,
        metadata,
        info: ExtractionInfo {
            method: result.extraction_method,
            main_content_confidence: if result.text.trim().is_empty() {
                0.0
            } else {
                1.0
            },
            fallback_used: false,
        },
        warnings,
    })
}

fn pdf_markdown_by_page(
    bytes: &[u8],
    mime: Option<&str>,
    url: Option<&str>,
    full_result: &lyra_docs_core::DocumentReadResult,
) -> Result<String, ReaderError> {
    let Some(page_count) = full_result.page_count else {
        return Ok(clean_pdf_text(&full_result.text));
    };
    if page_count <= 1 {
        return Ok(format!(
            "<!-- page: 1 -->\n\n{}",
            clean_pdf_text(&full_result.text)
        ));
    }

    let mut page_texts = Vec::new();
    for page in 1..=page_count {
        let result = lyra_docs_core::read_document_text(lyra_docs_core::DocumentReadRequest {
            bytes: bytes.to_vec(),
            mime_hint: mime.map(str::to_string),
            url_hint: url.map(str::to_string),
            scope: lyra_docs_core::DocumentReadScope::PageRange,
            page_start: Some(page),
            page_end: Some(page),
            visible_pages: Vec::new(),
            current_page: None,
            max_chars: Some(250_000),
            cursor: None,
        })
        .map_err(|error| ReaderError::Parse(format!("pdf page parse failed: {error}")))?;
        page_texts.push((page, result.text));
    }

    let repeated_boundaries = repeated_pdf_boundary_lines(&page_texts);
    let mut pages = Vec::new();
    for (page, raw_text) in page_texts {
        let text = clean_pdf_text_with_repeated(&raw_text, &repeated_boundaries);
        if !text.trim().is_empty() {
            pages.push(format!("<!-- page: {page} -->\n\n{text}"));
        }
    }
    if pages.is_empty() {
        Ok(clean_pdf_text(&full_result.text))
    } else {
        Ok(pages.join("\n\n"))
    }
}

fn clean_pdf_text(text: &str) -> String {
    clean_pdf_text_with_repeated(text, &HashSet::new())
}

fn clean_pdf_text_with_repeated(text: &str, repeated_boundaries: &HashSet<String>) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let hyphen_repaired = Regex::new(r"(?m)([[:alpha:]])-\n([[:alpha:]])")
        .ok()
        .map(|regex| regex.replace_all(&normalized, "$1$2").to_string())
        .unwrap_or(normalized);
    let mut out = String::new();
    let mut previous_was_blank = false;
    for raw_line in hyphen_repaired.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            if !previous_was_blank && !out.trim().is_empty() {
                out.push_str("\n\n");
            }
            previous_was_blank = true;
            continue;
        }
        if line.chars().all(|ch| ch.is_ascii_digit()) && line.len() <= 4 {
            continue;
        }
        if repeated_boundaries.contains(line) {
            continue;
        }
        if !out.is_empty() && !out.ends_with("\n\n") {
            let last = out.chars().rev().find(|ch| !ch.is_whitespace());
            if matches!(last, Some('.') | Some('!') | Some('?') | Some(':')) {
                out.push('\n');
            } else {
                out.push(' ');
            }
        }
        out.push_str(line);
        previous_was_blank = false;
    }
    out.trim().to_string()
}

fn repeated_pdf_boundary_lines(page_texts: &[(u32, String)]) -> HashSet<String> {
    if page_texts.len() < 2 {
        return HashSet::new();
    }
    let mut counts = HashMap::<String, usize>::new();
    for (_page, text) in page_texts {
        let lines = normalized_nonempty_lines(text);
        if let Some(first) = lines.first() {
            if is_repeated_boundary_candidate(first) {
                *counts.entry(first.clone()).or_insert(0) += 1;
            }
        }
        if let Some(last) = lines.last() {
            if lines.first() != Some(last) && is_repeated_boundary_candidate(last) {
                *counts.entry(last.clone()).or_insert(0) += 1;
            }
        }
    }
    counts
        .into_iter()
        .filter_map(|(line, count)| (count >= 2).then_some(line))
        .collect()
}

fn normalized_nonempty_lines(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_repeated_boundary_candidate(line: &str) -> bool {
    let len = line.chars().count();
    (3..=80).contains(&len) && !line.chars().all(|ch| ch.is_ascii_digit())
}

pub fn render_office_fallback(
    format: &str,
    bytes: &[u8],
    url: Option<&str>,
) -> Result<RenderedDocument, ReaderError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| ReaderError::Parse(format!("office zip parse failed: {error}")))?;
    let markdown = match format {
        "docx" => render_docx(&mut archive)?,
        "pptx" => render_pptx(&mut archive)?,
        "xlsx" => render_xlsx(&mut archive)?,
        _ => {
            return Err(ReaderError::UnsupportedFormat {
                format: format.to_string(),
                mime: String::new(),
                final_url: url.map(str::to_string),
            });
        }
    };
    let mut metadata = ReaderMetadata::default();
    metadata.title = url.and_then(title_from_url);
    Ok(RenderedDocument {
        markdown,
        metadata,
        info: ExtractionInfo {
            method: format!("office:{format}:rust-fallback"),
            main_content_confidence: 0.65,
            fallback_used: true,
        },
        warnings: Vec::new(),
    })
}

pub fn render_image(
    bytes: &[u8],
    mime: Option<&str>,
    url: Option<&str>,
    use_ocr: bool,
    use_caption: bool,
) -> RenderedDocument {
    let metadata = image_metadata(bytes, mime, url);
    let mut reader_metadata = ReaderMetadata::default();
    reader_metadata.title = url.and_then(title_from_url);
    let mut markdown = String::new();
    markdown.push_str("# Image\n\n");
    markdown.push_str(&format!("Format: {}\n\n", metadata.format));
    if let (Some(width), Some(height)) = (metadata.width, metadata.height) {
        markdown.push_str(&format!("Dimensions: {width} x {height}\n\n"));
    }
    if let Some(color_mode) = metadata.color_mode.as_deref() {
        markdown.push_str(&format!("Color mode: {color_mode}\n\n"));
    }
    if let Some(orientation) = metadata.exif_orientation {
        markdown.push_str(&format!("EXIF orientation: {orientation}\n\n"));
    }
    markdown.push_str(&format!("File size: {} bytes\n", bytes.len()));
    if let Some(text) = metadata.svg_text {
        markdown.push_str("\n## SVG Text\n\n");
        markdown.push_str(text.trim());
    }
    let mut warnings = Vec::new();
    let mut ocr_text_found = false;
    if use_ocr
        && let Some(text) = tesseract_ocr_text(bytes, &metadata.format, mime, &mut warnings)
        && !text.trim().is_empty()
    {
        ocr_text_found = true;
        markdown.push_str("\n\n## OCR Text\n\n");
        markdown.push_str(text.trim());
    }
    if metadata.format != "svg" {
        if use_ocr && !ocr_text_found {
            warnings.push(ReaderWarning {
                code: WarningCode::OcrRecommended,
                message: "Image OCR produced no text or was unavailable".to_string(),
            });
        }
        if use_caption {
            warnings.push(ReaderWarning {
                code: WarningCode::CaptionUnavailable,
                message: "Image caption provider is not connected in this reader context"
                    .to_string(),
            });
        }
    }
    RenderedDocument {
        markdown,
        metadata: reader_metadata,
        info: ExtractionInfo {
            method: "image:metadata".to_string(),
            main_content_confidence: if metadata.format == "svg" { 0.7 } else { 0.35 },
            fallback_used: false,
        },
        warnings,
    }
}

struct ImageMetadata {
    format: String,
    width: Option<u32>,
    height: Option<u32>,
    color_mode: Option<String>,
    exif_orientation: Option<u16>,
    svg_text: Option<String>,
}

fn render_docx(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<String, ReaderError> {
    let xml = read_zip_text(archive, "word/document.xml")?;
    let rels = read_zip_text(archive, "word/_rels/document.xml.rels")
        .map(|xml| relationship_targets(&xml))
        .unwrap_or_default();
    let mut sections = Vec::new();
    let body = docx_blocks(&xml, &rels);
    if !body.trim().is_empty() {
        sections.push(body.trim().to_string());
    }
    if let Ok(footnotes_xml) = read_zip_text(archive, "word/footnotes.xml") {
        let footnotes = docx_notes(&footnotes_xml, "footnote");
        if !footnotes.is_empty() {
            sections.push(format!("## Footnotes\n\n{}", footnotes.join("\n\n")));
        }
    }
    if let Ok(endnotes_xml) = read_zip_text(archive, "word/endnotes.xml") {
        let endnotes = docx_notes(&endnotes_xml, "endnote");
        if !endnotes.is_empty() {
            sections.push(format!("## Endnotes\n\n{}", endnotes.join("\n\n")));
        }
    }
    let images = relationship_image_refs(&xml, &rels, "word");
    if !images.is_empty() {
        sections.push(format!("## Images\n\n{}", image_reference_list(&images)));
    }
    Ok(format!(
        "# DOCX Document\n\n{}",
        sections.join("\n\n").trim()
    ))
}

fn render_pptx(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<String, ReaderError> {
    let mut names = zip_names(archive)
        .into_iter()
        .filter(|name| name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
        .collect::<Vec<_>>();
    names.sort();
    let mut out = String::from("# PPTX Deck\n");
    for (index, name) in names.iter().enumerate() {
        let xml = read_zip_text(archive, name)?;
        let text = xml_text(&xml);
        let tables = pptx_tables(&xml);
        let slide_rels = pptx_slide_relationships(archive, name);
        let images = relationship_image_refs(&xml, &slide_rels, "ppt/slides");
        if !text.trim().is_empty() {
            out.push_str(&format!("\n\n## Slide {}\n\n{}", index + 1, text.trim()));
        }
        if !tables.is_empty() {
            out.push_str(&format!(
                "\n\n### Slide {} Tables\n\n{}",
                index + 1,
                tables.join("\n\n")
            ));
        }
        if !images.is_empty() {
            out.push_str(&format!(
                "\n\n### Slide {} Images\n\n{}",
                index + 1,
                image_reference_list(&images)
            ));
        }
    }
    let mut note_names = zip_names(archive)
        .into_iter()
        .filter(|name| name.starts_with("ppt/notesSlides/notesSlide") && name.ends_with(".xml"))
        .collect::<Vec<_>>();
    note_names.sort();
    for (index, name) in note_names.iter().enumerate() {
        let xml = read_zip_text(archive, name)?;
        let text = xml_text(&xml);
        if !text.trim().is_empty() {
            out.push_str(&format!(
                "\n\n### Speaker Notes {}\n\n{}",
                index + 1,
                text.trim()
            ));
        }
    }
    Ok(out)
}

fn render_xlsx(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<String, ReaderError> {
    let shared = read_zip_text(archive, "xl/sharedStrings.xml")
        .map(|xml| xml_text_items(&xml))
        .unwrap_or_default();
    let mut names = zip_names(archive)
        .into_iter()
        .filter(|name| name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml"))
        .collect::<Vec<_>>();
    names.sort();
    let mut out = String::from("# XLSX Workbook\n");
    for (index, name) in names.iter().enumerate() {
        let xml = read_zip_text(archive, name)?;
        let (mut rows, truncated) = xlsx_rows(&xml, &shared);
        if !rows.is_empty() {
            out.push_str(&format!("\n\n## Sheet {}\n\n", index + 1));
            if truncated {
                rows.push(vec![format!(
                    "Sheet truncated after {MAX_XLSX_ROWS} rows / {MAX_XLSX_COLUMNS} columns"
                )]);
            }
            out.push_str(&markdown_table(&rows));
        }
        let merged = xlsx_merged_ranges(&xml);
        if !merged.is_empty() {
            out.push_str("\n\nMerged cells: ");
            out.push_str(&merged.join(", "));
        }
    }
    Ok(out)
}

fn image_metadata(bytes: &[u8], mime: Option<&str>, url: Option<&str>) -> ImageMetadata {
    let decoded = image::load_from_memory(bytes).ok();
    let decoded_dimensions = decoded.as_ref().map(|image| {
        (
            image.width(),
            image.height(),
            format!("{:?}", image.color()),
        )
    });
    let exif_orientation = jpeg_exif_orientation(bytes);
    if bytes.starts_with(b"\x89PNG\r\n\x1A\n") && bytes.len() >= 24 {
        return ImageMetadata {
            format: "png".to_string(),
            width: Some(u32::from_be_bytes([
                bytes[16], bytes[17], bytes[18], bytes[19],
            ])),
            height: Some(u32::from_be_bytes([
                bytes[20], bytes[21], bytes[22], bytes[23],
            ])),
            color_mode: decoded_dimensions.as_ref().map(|(_, _, mode)| mode.clone()),
            exif_orientation,
            svg_text: None,
        };
    }
    if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && bytes.len() >= 10 {
        return ImageMetadata {
            format: "gif".to_string(),
            width: Some(u16::from_le_bytes([bytes[6], bytes[7]]) as u32),
            height: Some(u16::from_le_bytes([bytes[8], bytes[9]]) as u32),
            color_mode: decoded_dimensions.as_ref().map(|(_, _, mode)| mode.clone()),
            exif_orientation,
            svg_text: None,
        };
    }
    if bytes.starts_with(b"BM") && bytes.len() >= 26 {
        return ImageMetadata {
            format: "bmp".to_string(),
            width: Some(u32::from_le_bytes([
                bytes[18], bytes[19], bytes[20], bytes[21],
            ])),
            height: Some(u32::from_le_bytes([
                bytes[22], bytes[23], bytes[24], bytes[25],
            ])),
            color_mode: decoded_dimensions.as_ref().map(|(_, _, mode)| mode.clone()),
            exif_orientation,
            svg_text: None,
        };
    }
    if let Some((width, height)) = jpeg_dimensions(bytes) {
        return ImageMetadata {
            format: "jpeg".to_string(),
            width: Some(width),
            height: Some(height),
            color_mode: decoded_dimensions.as_ref().map(|(_, _, mode)| mode.clone()),
            exif_orientation,
            svg_text: None,
        };
    }
    if let Some((width, height)) = webp_dimensions(bytes) {
        return ImageMetadata {
            format: "webp".to_string(),
            width: Some(width),
            height: Some(height),
            color_mode: decoded_dimensions.as_ref().map(|(_, _, mode)| mode.clone()),
            exif_orientation,
            svg_text: None,
        };
    }
    if is_svg(bytes, mime, url) {
        let text = String::from_utf8_lossy(bytes);
        return ImageMetadata {
            format: "svg".to_string(),
            width: None,
            height: None,
            color_mode: None,
            exif_orientation: None,
            svg_text: Some(svg_text(&text)),
        };
    }
    if let Some((width, height, color_mode)) = decoded_dimensions {
        return ImageMetadata {
            format: mime
                .and_then(|value| value.split('/').nth(1))
                .unwrap_or("image")
                .to_string(),
            width: Some(width),
            height: Some(height),
            color_mode: Some(color_mode),
            exif_orientation,
            svg_text: None,
        };
    }
    ImageMetadata {
        format: mime
            .and_then(|value| value.split('/').nth(1))
            .unwrap_or("image")
            .to_string(),
        width: None,
        height: None,
        color_mode: None,
        exif_orientation,
        svg_text: None,
    }
}

fn read_zip_text(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> Result<String, ReaderError> {
    let mut file = archive
        .by_name(name)
        .map_err(|error| ReaderError::Parse(format!("missing {name}: {error}")))?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| ReaderError::Parse(format!("failed to read {name}: {error}")))?;
    Ok(text)
}

fn zip_names(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Vec<String> {
    (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|file| file.name().to_string())
        })
        .collect()
}

fn xml_text(xml: &str) -> String {
    xml_text_items(xml).join("\n")
}

fn docx_blocks(xml: &str, rels: &std::collections::HashMap<String, String>) -> String {
    let mut blocks = Vec::new();
    let mut cursor = 0usize;
    while cursor < xml.len() {
        let next_p = xml[cursor..].find("<w:p").map(|index| cursor + index);
        let next_tbl = xml[cursor..].find("<w:tbl").map(|index| cursor + index);
        let Some(start) = earliest(next_p, next_tbl) else {
            break;
        };
        if Some(start) == next_tbl {
            let Some(end) = xml[start..].find("</w:tbl>").map(|index| start + index + 8) else {
                break;
            };
            let block = &xml[start..end];
            let rows = docx_table_rows(block);
            if !rows.is_empty() {
                blocks.push(markdown_table(&rows));
            }
            cursor = end;
        } else {
            let Some(end) = xml[start..].find("</w:p>").map(|index| start + index + 6) else {
                break;
            };
            let block = &xml[start..end];
            let paragraph = docx_paragraph(block, rels);
            if !paragraph.trim().is_empty() {
                blocks.push(paragraph);
            }
            cursor = end;
        }
    }
    blocks.join("\n\n")
}

fn earliest(a: Option<usize>, b: Option<usize>) -> Option<usize> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn docx_paragraph(xml: &str, rels: &std::collections::HashMap<String, String>) -> String {
    let mut text = replace_docx_hyperlinks(xml, rels);
    if text.trim().is_empty() {
        text = xml_text_items(xml).join(" ");
    }
    let text = collapse_spaces(&text);
    if text.is_empty() {
        return String::new();
    }
    if let Some(level) = docx_heading_level(xml) {
        return format!("{} {text}", "#".repeat(level));
    }
    if docx_is_list_item(xml) {
        return format!("- {text}");
    }
    text
}

fn replace_docx_hyperlinks(xml: &str, rels: &std::collections::HashMap<String, String>) -> String {
    let hyperlink_re = match Regex::new(r#"(?s)<w:hyperlink\b([^>]*)>(.*?)</w:hyperlink>"#) {
        Ok(value) => value,
        Err(_) => return String::new(),
    };
    let mut out = String::new();
    let mut cursor = 0usize;
    for capture in hyperlink_re.captures_iter(xml) {
        let Some(full) = capture.get(0) else {
            continue;
        };
        out.push_str(&xml_text_items(&xml[cursor..full.start()]).join(" "));
        let attrs = capture.get(1).map(|value| value.as_str()).unwrap_or("");
        let body = capture.get(2).map(|value| value.as_str()).unwrap_or("");
        let label = collapse_spaces(&xml_text_items(body).join(" "));
        if let Some(id) = attr_value(attrs, "r:id").or_else(|| attr_value(attrs, "id"))
            && let Some(target) = rels.get(&id)
            && !label.is_empty()
        {
            out.push_str(&format!("[{label}]({target})"));
        } else {
            out.push_str(&label);
        }
        cursor = full.end();
    }
    out.push_str(&xml_text_items(&xml[cursor..]).join(" "));
    collapse_spaces(&out)
}

fn docx_heading_level(xml: &str) -> Option<usize> {
    let value =
        attr_after(xml, "w:pStyle", "w:val").or_else(|| attr_after(xml, "pStyle", "val"))?;
    let lower = value.to_ascii_lowercase();
    if let Some(number) = lower
        .strip_prefix("heading")
        .and_then(|tail| tail.parse::<usize>().ok())
    {
        return Some(number.clamp(1, 6));
    }
    if let Some(number) = lower
        .strip_prefix("title")
        .and_then(|tail| tail.parse::<usize>().ok())
    {
        return Some(number.clamp(1, 6));
    }
    None
}

fn docx_is_list_item(xml: &str) -> bool {
    xml.contains("<w:numPr") || xml.contains("<numPr")
}

fn docx_table_rows(xml: &str) -> Vec<Vec<String>> {
    let row_re = match Regex::new(r"(?s)<w:tr\b[^>]*>(.*?)</w:tr>") {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let cell_re = match Regex::new(r"(?s)<w:tc\b[^>]*>(.*?)</w:tc>") {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    row_re
        .captures_iter(xml)
        .map(|row| {
            let body = row.get(1).map(|value| value.as_str()).unwrap_or("");
            cell_re
                .captures_iter(body)
                .map(|cell| {
                    let body = cell.get(1).map(|value| value.as_str()).unwrap_or("");
                    collapse_spaces(&xml_text_items(body).join(" "))
                })
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|row| !row.is_empty())
        .collect()
}

fn docx_notes(xml: &str, tag: &str) -> Vec<String> {
    let note_re = match Regex::new(&format!(r#"(?s)<w:{tag}\b([^>]*)>(.*?)</w:{tag}>"#)) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    note_re
        .captures_iter(xml)
        .filter_map(|capture| {
            let attrs = capture.get(1)?.as_str();
            let body = capture.get(2)?.as_str();
            let kind = attr_value(attrs, "w:type").or_else(|| attr_value(attrs, "type"));
            if matches!(
                kind.as_deref(),
                Some("separator") | Some("continuationSeparator")
            ) {
                return None;
            }
            let text = collapse_spaces(&xml_text_items(body).join(" "));
            if text.is_empty() {
                return None;
            }
            let id = attr_value(attrs, "w:id").or_else(|| attr_value(attrs, "id"));
            Some(match id {
                Some(id) => format!("[{id}] {text}"),
                None => text,
            })
        })
        .collect()
}

fn relationship_image_refs(
    xml: &str,
    rels: &std::collections::HashMap<String, String>,
    base: &str,
) -> Vec<String> {
    let embed_re = match Regex::new(r#"(?:r:embed|r:link|embed|link)=["']([^"']+)["']"#) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut images = Vec::new();
    for id in embed_re
        .captures_iter(xml)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str()))
    {
        let Some(target) = rels.get(id) else {
            continue;
        };
        if !looks_like_image_target(target) {
            continue;
        }
        let reference = relationship_target_path(base, target);
        if seen.insert(reference.clone()) {
            images.push(reference);
        }
    }
    images
}

fn image_reference_list(images: &[String]) -> String {
    images
        .iter()
        .map(|image| format!("- {image}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn looks_like_image_target(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.contains("/media/")
        || lower.starts_with("media/")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
        || lower.ends_with(".tif")
        || lower.ends_with(".tiff")
        || lower.ends_with(".svg")
}

fn relationship_target_path(base: &str, target: &str) -> String {
    if target.contains("://") || target.starts_with('/') {
        return target.to_string();
    }
    let mut parts = base
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value.to_string()),
        }
    }
    parts.join("/")
}

fn xml_text_items(xml: &str) -> Vec<String> {
    let tag_re = Regex::new(r"(?s)<[^>]+>").ok();
    let cleaned = tag_re
        .as_ref()
        .map(|regex| regex.replace_all(xml, "\n").to_string())
        .unwrap_or_else(|| xml.to_string());
    cleaned
        .lines()
        .map(decode_entities)
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

fn pptx_tables(xml: &str) -> Vec<String> {
    let table_re = match Regex::new(r#"(?s)<a:tbl\b[^>]*>(.*?)</a:tbl>"#) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let row_re = match Regex::new(r#"(?s)<a:tr\b[^>]*>(.*?)</a:tr>"#) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let cell_re = match Regex::new(r#"(?s)<a:tc\b[^>]*>(.*?)</a:tc>"#) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    table_re
        .captures_iter(xml)
        .filter_map(|table| {
            let body = table.get(1)?.as_str();
            let rows = row_re
                .captures_iter(body)
                .map(|row| {
                    let row_body = row.get(1).map(|value| value.as_str()).unwrap_or("");
                    cell_re
                        .captures_iter(row_body)
                        .map(|cell| {
                            let cell_body = cell.get(1).map(|value| value.as_str()).unwrap_or("");
                            collapse_spaces(&xml_text_items(cell_body).join(" "))
                        })
                        .collect::<Vec<_>>()
                })
                .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
                .collect::<Vec<_>>();
            (!rows.is_empty()).then(|| markdown_table(&rows))
        })
        .collect()
}

fn pptx_slide_relationships(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    slide_name: &str,
) -> std::collections::HashMap<String, String> {
    let Some(file_name) = slide_name.rsplit('/').next() else {
        return std::collections::HashMap::new();
    };
    let rel_path = format!("ppt/slides/_rels/{file_name}.rels");
    read_zip_text(archive, &rel_path)
        .map(|xml| relationship_targets(&xml))
        .unwrap_or_default()
}

fn xlsx_rows(xml: &str, shared: &[String]) -> (Vec<Vec<String>>, bool) {
    let row_re = match Regex::new(r#"(?s)<row\b[^>]*>(.*?)</row>"#) {
        Ok(value) => value,
        Err(_) => return (Vec::new(), false),
    };
    let mut truncated = false;
    let rows = row_re
        .captures_iter(xml)
        .take(MAX_XLSX_ROWS.saturating_add(1))
        .enumerate()
        .filter_map(|(index, row)| {
            if index >= MAX_XLSX_ROWS {
                truncated = true;
                return None;
            }
            let body = row.get(1).map(|value| value.as_str()).unwrap_or("");
            let mut cells = xlsx_cells(body, shared);
            if cells.len() > MAX_XLSX_COLUMNS {
                cells.truncate(MAX_XLSX_COLUMNS);
                truncated = true;
            }
            Some(cells)
        })
        .filter(|row| !row.is_empty())
        .collect();
    (rows, truncated)
}

fn xlsx_merged_ranges(xml: &str) -> Vec<String> {
    let merge_re = match Regex::new(r#"<mergeCell\b[^>]*\bref=["']([^"']+)["'][^>]*/?>"#) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    merge_re
        .captures_iter(xml)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str().to_string()))
        .take(200)
        .collect()
}

fn xlsx_cells(xml: &str, shared: &[String]) -> Vec<String> {
    let cell_re = match Regex::new(r#"(?s)<c\b([^>]*)>(.*?)</c>"#) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let value_re = match Regex::new(r#"(?s)<v>(.*?)</v>"#) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let text_re = Regex::new(r#"(?s)<t[^>]*>(.*?)</t>"#).ok();
    cell_re
        .captures_iter(xml)
        .filter_map(|capture| {
            let attrs = capture.get(1)?.as_str();
            let body = capture.get(2)?.as_str();
            if attrs.contains(r#"t="s""#) {
                let index = value_re
                    .captures(body)?
                    .get(1)?
                    .as_str()
                    .trim()
                    .parse::<usize>()
                    .ok()?;
                return shared.get(index).cloned();
            }
            if attrs.contains(r#"t="inlineStr""#) {
                return text_re.as_ref().and_then(|regex| {
                    regex
                        .captures(body)
                        .and_then(|text| text.get(1))
                        .map(|value| decode_entities(value.as_str()))
                });
            }
            let value = value_re
                .captures(body)
                .and_then(|value| value.get(1))
                .map(|value| decode_entities(value.as_str()));
            if let Some(formula) = formula_text(body) {
                return Some(match value {
                    Some(value) if !value.trim().is_empty() => format!("={formula} ({value})"),
                    _ => format!("={formula}"),
                });
            }
            value
        })
        .filter(|value| !value.trim().is_empty())
        .collect()
}

fn formula_text(xml: &str) -> Option<String> {
    let regex = Regex::new(r#"(?s)<f[^>]*>(.*?)</f>"#).ok()?;
    regex
        .captures(xml)
        .and_then(|capture| capture.get(1))
        .map(|value| decode_entities(value.as_str()).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn markdown_table(rows: &[Vec<String>]) -> String {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return String::new();
    }
    let mut normalized = rows
        .iter()
        .map(|row| {
            let mut row = row.clone();
            row.resize(width, String::new());
            row.into_iter()
                .map(|cell| cell.replace('|', "\\|").replace('\n', " "))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if normalized.len() == 1 {
        normalized.insert(
            0,
            (1..=width).map(|index| format!("Column {index}")).collect(),
        );
    }
    let mut out = String::new();
    out.push('|');
    out.push_str(&normalized[0].join(" | "));
    out.push_str(" |\n|");
    out.push_str(&vec!["---"; width].join(" | "));
    out.push('|');
    for row in normalized.iter().skip(1) {
        out.push('\n');
        out.push('|');
        out.push_str(&row.join(" | "));
        out.push_str(" |");
    }
    out
}

fn relationship_targets(xml: &str) -> std::collections::HashMap<String, String> {
    let rel_re = match Regex::new(r#"<Relationship\b([^>]*)/?>"#) {
        Ok(value) => value,
        Err(_) => return std::collections::HashMap::new(),
    };
    rel_re
        .captures_iter(xml)
        .filter_map(|capture| {
            let attrs = capture.get(1)?.as_str();
            Some((attr_value(attrs, "Id")?, attr_value(attrs, "Target")?))
        })
        .collect()
}

fn attr_after(xml: &str, tag: &str, attr: &str) -> Option<String> {
    let tag_index = xml.find(tag)?;
    let after = &xml[tag_index..xml.len().min(tag_index + 256)];
    attr_value(after, attr)
}

fn attr_value(attrs: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let marker = format!("{name}={quote}");
        if let Some(start) = attrs.find(&marker) {
            let value_start = start + marker.len();
            let value_end = attrs[value_start..].find(quote)? + value_start;
            return Some(decode_entities(&attrs[value_start..value_end]));
        }
    }
    None
}

fn collapse_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut index = 2usize;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        let len = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
        if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]) as u32;
            return Some((width, height));
        }
        index = index.saturating_add(2 + len);
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => {
            let width = 1
                + u32::from(bytes[24])
                + (u32::from(bytes[25]) << 8)
                + (u32::from(bytes[26]) << 16);
            let height = 1
                + u32::from(bytes[27])
                + (u32::from(bytes[28]) << 8)
                + (u32::from(bytes[29]) << 16);
            Some((width, height))
        }
        _ => None,
    }
}

fn jpeg_exif_orientation(bytes: &[u8]) -> Option<u16> {
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut index = 2usize;
    while index + 4 < bytes.len() {
        if bytes[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        let len = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
        if marker == 0xE1 && index + 4 + len <= bytes.len() {
            let segment = &bytes[index + 4..index + 2 + len];
            if segment.starts_with(b"Exif\0\0") {
                return tiff_orientation(&segment[6..]);
            }
        }
        index = index.saturating_add(2 + len);
    }
    None
}

fn tiff_orientation(tiff: &[u8]) -> Option<u16> {
    if tiff.len() < 8 {
        return None;
    }
    let little = match &tiff[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let read_u16 = |offset: usize| -> Option<u16> {
        let bytes = [*tiff.get(offset)?, *tiff.get(offset + 1)?];
        Some(if little {
            u16::from_le_bytes(bytes)
        } else {
            u16::from_be_bytes(bytes)
        })
    };
    let read_u32 = |offset: usize| -> Option<u32> {
        let bytes = [
            *tiff.get(offset)?,
            *tiff.get(offset + 1)?,
            *tiff.get(offset + 2)?,
            *tiff.get(offset + 3)?,
        ];
        Some(if little {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        })
    };
    if read_u16(2)? != 42 {
        return None;
    }
    let ifd_offset = read_u32(4)? as usize;
    let entry_count = read_u16(ifd_offset)? as usize;
    for entry in 0..entry_count {
        let offset = ifd_offset + 2 + entry * 12;
        if read_u16(offset)? == 0x0112 {
            return read_u16(offset + 8);
        }
    }
    None
}

fn tesseract_ocr_text(
    bytes: &[u8],
    format: &str,
    mime: Option<&str>,
    warnings: &mut Vec<ReaderWarning>,
) -> Option<String> {
    if format == "svg" {
        return None;
    }
    let Ok(binary) = std::env::var("LYRA_AGENT_READER_TESSERACT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| which::which("tesseract").ok())
        .ok_or(())
    else {
        warnings.push(ReaderWarning {
            code: WarningCode::OcrUnavailable,
            message: "Tesseract was not available; image OCR was skipped".to_string(),
        });
        return None;
    };
    let temp_dir = match tempfile::tempdir() {
        Ok(value) => value,
        Err(error) => {
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!("OCR temp directory creation failed: {error}"),
            });
            return None;
        }
    };
    let extension = image_extension(format, mime);
    let input_path = temp_dir.path().join(format!("input.{extension}"));
    if let Err(error) = std::fs::write(&input_path, bytes) {
        warnings.push(ReaderWarning {
            code: WarningCode::ExternalAdapterFailed,
            message: format!("OCR input write failed: {error}"),
        });
        return None;
    }
    let output_base = temp_dir.path().join("output");
    let mut child = match Command::new(binary)
        .arg(&input_path)
        .arg(&output_base)
        .arg("--dpi")
        .arg("150")
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!("Tesseract failed to start: {error}"),
            });
            return None;
        }
    };
    let timeout = Duration::from_secs(20);
    let start = Instant::now();
    while start.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                return std::fs::read_to_string(output_base.with_extension("txt")).ok();
            }
            Ok(Some(status)) => {
                warnings.push(ReaderWarning {
                    code: WarningCode::ExternalAdapterFailed,
                    message: format!("Tesseract exited with status {status}"),
                });
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                warnings.push(ReaderWarning {
                    code: WarningCode::ExternalAdapterFailed,
                    message: format!("Tesseract wait failed: {error}"),
                });
                return None;
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    warnings.push(ReaderWarning {
        code: WarningCode::ExternalAdapterFailed,
        message: "Tesseract OCR timed out after 20 seconds".to_string(),
    });
    None
}

fn image_extension(format: &str, mime: Option<&str>) -> &'static str {
    match format {
        "jpeg" | "jpg" => "jpg",
        "png" => "png",
        "webp" => "webp",
        "gif" => "gif",
        "bmp" => "bmp",
        "tiff" | "tif" => "tiff",
        _ => match mime.unwrap_or_default() {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/png" => "png",
            "image/webp" => "webp",
            "image/gif" => "gif",
            "image/bmp" => "bmp",
            "image/tiff" => "tiff",
            _ => "img",
        },
    }
}

fn is_svg(bytes: &[u8], mime: Option<&str>, url: Option<&str>) -> bool {
    mime.map(|value| value.to_ascii_lowercase().contains("svg"))
        .unwrap_or(false)
        || url
            .map(|value| value.to_ascii_lowercase().ends_with(".svg"))
            .unwrap_or(false)
        || String::from_utf8_lossy(&bytes[..bytes.len().min(256)])
            .to_ascii_lowercase()
            .contains("<svg")
}

fn svg_text(svg: &str) -> String {
    let keep_re = match Regex::new(r"(?is)<(title|desc|text)[^>]*>(.*?)</(title|desc|text)>") {
        Ok(value) => value,
        Err(_) => return String::new(),
    };
    keep_re
        .captures_iter(svg)
        .filter_map(|capture| capture.get(2).map(|value| decode_entities(value.as_str())))
        .map(|value| {
            Regex::new(r"(?s)<[^>]+>")
                .ok()
                .map(|regex| regex.replace_all(&value, "").to_string())
                .unwrap_or(value)
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn title_from_url(url: &str) -> Option<String> {
    url.rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .map(|value| value.split('?').next().unwrap_or(value).to_string())
}
