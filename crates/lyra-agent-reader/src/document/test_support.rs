//! Shared fixtures for document pipeline unit tests.

use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::document::run;
use crate::errors::ReaderError;
use crate::fetch::{BrowserSnapshotProvider, BrowserSnapshotRequest, FetchProvider, FetchRequest};
use crate::types::{
    BrowserMode, BrowserWaitUntil, ReaderInput, ReaderOptions, ReaderRequest, ReaderResult,
};

pub(super) struct StaticFetch {
    pub(super) body: Vec<u8>,
    pub(super) content_type: &'static str,
}

impl FetchProvider for StaticFetch {
    fn fetch(
        &self,
        request: &FetchRequest<'_>,
    ) -> Result<crate::fetch::FetchResponse, ReaderError> {
        Ok(crate::fetch::FetchResponse {
            final_url: request.url.to_string(),
            status: 200,
            content_type: Some(self.content_type.to_string()),
            headers: Vec::new(),
            body: self.body.clone(),
        })
    }
}

pub(super) struct RedirectFetch {
    location: String,
    calls: AtomicUsize,
}

impl RedirectFetch {
    pub(super) fn new(location: &str) -> Self {
        Self {
            location: location.to_string(),
            calls: AtomicUsize::new(0),
        }
    }

    pub(super) fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl FetchProvider for RedirectFetch {
    fn fetch(
        &self,
        request: &FetchRequest<'_>,
    ) -> Result<crate::fetch::FetchResponse, ReaderError> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        if call == 0 {
            return Ok(crate::fetch::FetchResponse {
                final_url: request.url.to_string(),
                status: 302,
                content_type: Some("text/html".to_string()),
                headers: vec![("location".to_string(), self.location.clone())],
                body: Vec::new(),
            });
        }
        Ok(crate::fetch::FetchResponse {
            final_url: request.url.to_string(),
            status: 200,
            content_type: Some("text/html".to_string()),
            headers: Vec::new(),
            body: b"<html><body><main>redirected body</main></body></html>".to_vec(),
        })
    }
}

pub(super) struct StaticBrowser;

impl BrowserSnapshotProvider for StaticBrowser {
    fn snapshot(
        &self,
        request: &BrowserSnapshotRequest<'_>,
    ) -> Result<crate::fetch::BrowserSnapshot, ReaderError> {
        assert_eq!(request.browser_mode, BrowserMode::MatchingOrNewTab);
        assert_eq!(request.wait_until, BrowserWaitUntil::AutoSmart);
        Ok(crate::fetch::BrowserSnapshot {
            final_url: request.url.to_string(),
            html: r#"<html><head><title>Rendered App</title></head><body><main><h1>Rendered</h1><p>Dynamic browser text is now available.</p></main></body></html>"#.to_string(),
            title: Some("Rendered App".to_string()),
            body_text: Some("Rendered Dynamic browser text is now available.".to_string()),
            screenshot_artifact_ref: None,
            pageshot_artifact_ref: None,
            viewport: None,
            selected_element: None,
            frames: Vec::new(),
            shadow_roots: Vec::new(),
            media: Vec::new(),
            artifacts: Vec::new(),
            warnings: Vec::new(),
            ax_elements: Vec::new(),
        })
    }
}

pub(super) fn read_html_result(
    html: &str,
    options: ReaderOptions,
) -> Result<ReaderResult, ReaderError> {
    let request = ReaderRequest {
        input: ReaderInput::RawHtml {
            html: html.to_string(),
            base_url: Some("https://x.test/".to_string()),
        },
        options,
    };
    run(&request, None)
}

pub(super) fn read_bytes_result(
    bytes: Vec<u8>,
    mime: &str,
    base_url: &str,
) -> Result<ReaderResult, ReaderError> {
    read_bytes_result_with_options(bytes, mime, base_url, ReaderOptions::default())
}

pub(super) fn read_bytes_result_with_options(
    bytes: Vec<u8>,
    mime: &str,
    base_url: &str,
    options: ReaderOptions,
) -> Result<ReaderResult, ReaderError> {
    let request = ReaderRequest {
        input: ReaderInput::Bytes {
            bytes,
            mime: Some(mime.to_string()),
            base_url: Some(base_url.to_string()),
        },
        options,
    };
    run(&request, None)
}

pub(super) fn build_simple_pdf(text: &str) -> Vec<u8> {
    let stream = format!("BT /F1 24 Tf 72 720 Td ({text}) Tj ET");
    let objects = vec![
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_string(),
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n".to_string(),
        format!(
            "4 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n",
            stream.len(),
            stream
        ),
        "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_string(),
    ];
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0usize];
    for object in &objects {
        offsets.push(pdf.len());
        pdf.push_str(object);
    }
    let xref_offset = pdf.len();
    pdf.push_str("xref\n0 6\n");
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str("trailer\n<< /Root 1 0 R /Size 6 >>\n");
    pdf.push_str(&format!("startxref\n{xref_offset}\n%%EOF\n"));
    pdf.into_bytes()
}

pub(super) fn build_multi_page_pdf(pages: &[&[&str]]) -> Vec<u8> {
    let page_count = pages.len();
    let page_object_start = 3usize;
    let content_object_start = page_object_start + page_count;
    let font_object_id = content_object_start + page_count;
    let kids = (0..page_count)
        .map(|index| format!("{} 0 R", page_object_start + index))
        .collect::<Vec<_>>()
        .join(" ");
    let mut objects = vec![
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
        format!(
            "2 0 obj\n<< /Type /Pages /Kids [{}] /Count {} >>\nendobj\n",
            kids, page_count
        ),
    ];
    for index in 0..page_count {
        objects.push(format!(
            "{} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {} 0 R >> >> /Contents {} 0 R >>\nendobj\n",
            page_object_start + index,
            font_object_id,
            content_object_start + index
        ));
    }
    for (index, lines) in pages.iter().enumerate() {
        let stream = pdf_text_stream(lines);
        objects.push(format!(
            "{} 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n",
            content_object_start + index,
            stream.len(),
            stream
        ));
    }
    objects.push(format!(
        "{font_object_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    ));

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0usize];
    for object in &objects {
        offsets.push(pdf.len());
        pdf.push_str(object);
    }
    let xref_offset = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Root 1 0 R /Size {} >>\n",
        objects.len() + 1
    ));
    pdf.push_str(&format!("startxref\n{xref_offset}\n%%EOF\n"));
    pdf.into_bytes()
}

pub(super) fn pdf_text_stream(lines: &[&str]) -> String {
    let mut stream = String::new();
    for (index, line) in lines.iter().enumerate() {
        let y = 720isize - index as isize * 20;
        stream.push_str(&format!("BT /F1 12 Tf 72 {y} Td ("));
        stream.push_str(&escape_pdf_text(line));
        stream.push_str(") Tj ET\n");
    }
    stream
}

pub(super) fn escape_pdf_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

pub(super) fn zip_bytes(files: &[(&str, &str)]) -> Vec<u8> {
    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default();
    for (name, content) in files {
        writer.start_file(name, options).expect("start zip file");
        writer
            .write_all(content.as_bytes())
            .expect("write zip file");
    }
    writer.finish().expect("finish zip").into_inner()
}

pub(super) fn read_html(html: &str, options: ReaderOptions) -> ReaderResult {
    read_html_result(html, options).unwrap()
}
