use lyra_docs_core::{
    read_document_text, search_document_text, DocumentReadRequest, DocumentReadScope,
    DocumentSearchRequest,
};

fn build_simple_pdf(text: &str) -> Vec<u8> {
    let stream = format!("BT /F1 24 Tf 72 720 Td ({}) Tj ET", text);
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
        pdf.push_str(&format!("{:010} 00000 n \n", offset));
    }
    pdf.push_str("trailer\n<< /Root 1 0 R /Size 6 >>\n");
    pdf.push_str(&format!("startxref\n{}\n%%EOF\n", xref_offset));
    pdf.into_bytes()
}

#[test]
fn reads_full_text_from_simple_pdf() {
    let bytes = build_simple_pdf("Hello PDF Reader");
    let result = read_document_text(DocumentReadRequest {
        bytes,
        mime_hint: Some("application/pdf".to_string()),
        url_hint: Some("https://example.com/test.pdf".to_string()),
        scope: DocumentReadScope::Full,
        page_start: None,
        page_end: None,
        visible_pages: Vec::new(),
        current_page: None,
        max_chars: Some(10_000),
        cursor: Some(0),
    })
    .expect("read pdf text");

    assert!(result.text.contains("Hello PDF Reader"));
    assert_eq!(result.page_count, Some(1));
    assert_eq!(result.extraction_method, "pdf:rust-parser");
}

#[test]
fn searches_text_in_simple_pdf() {
    let bytes = build_simple_pdf("Hello PDF Search");
    let result = search_document_text(DocumentSearchRequest {
        bytes,
        mime_hint: Some("application/pdf".to_string()),
        url_hint: Some("https://example.com/test.pdf".to_string()),
        query: "Search".to_string(),
        max_matches: Some(10),
    })
    .expect("search pdf text");

    assert_eq!(result.page_count, Some(1));
    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].page_index, Some(1));
    assert!(result.matches[0].excerpt.contains("Search"));
}
