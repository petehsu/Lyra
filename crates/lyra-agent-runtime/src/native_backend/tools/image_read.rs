//! Local image reads produce bounded vision evidence without a desktop viewer.
use super::*;
use image::{ImageFormat, ImageReader};
use std::io::{Cursor, Read};

const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_EDGE: u32 = 2048;

fn image_error(message: impl Into<String>) -> NativeToolFailure {
    NativeToolFailure::new(
        "image_read_failed",
        message,
        "Use a valid PNG, JPEG, WebP or GIF file. For animation, extract the relevant frames and read those images.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_reads_bound_pixels_validate_encoding_and_report_animation_scope() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("extensionless");
        image::RgbImage::new(4096, 16)
            .save_with_format(&source, ImageFormat::Png)
            .unwrap();
        assert!(is_image_file(&source));
        let result = read_image("image-read-test", "turn", "large-image", &source).unwrap();
        assert_eq!(result.raw["originalWidth"], 4096);
        assert_eq!(result.raw["width"], 2048);
        let path = result.raw["providerImage"]["path"].as_str().unwrap();
        let decoded = image::open(path).unwrap();
        assert_eq!(decoded.width(), 2048);
        assert!(fs::metadata(path).unwrap().len() <= MAX_IMAGE_BYTES as u64);

        let gif = temp.path().join("animated.gif");
        let mut encoder = image::codecs::gif::GifEncoder::new(fs::File::create(&gif).unwrap());
        encoder
            .encode_frames([
                image::Frame::new(image::RgbaImage::from_pixel(
                    4,
                    4,
                    image::Rgba([255, 0, 0, 255]),
                )),
                image::Frame::new(image::RgbaImage::from_pixel(
                    4,
                    4,
                    image::Rgba([0, 0, 255, 255]),
                )),
            ])
            .unwrap();
        drop(encoder);
        let frame = read_image("image-read-test", "turn", "animated", &gif).unwrap();
        assert!(frame.content.contains("first frame"));
        let pixel = image::open(frame.raw["providerImage"]["path"].as_str().unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!(pixel.get_pixel(0, 0).0, [255, 0, 0, 255]);

        let invalid = temp.path().join("invalid.png");
        fs::write(&invalid, b"\x89PNG\r\n\x1a\nnot-an-image").unwrap();
        assert!(read_image("image-read-test", "turn", "invalid", &invalid).is_err());
        assert!(read_image("image-read-test", "turn", "directory", temp.path()).is_err());
    }
}

pub(super) fn is_image_file(path: &Path) -> bool {
    // Sniff bytes as well as the name: downloaded images need not have an
    // extension, and corrupt .png files must fail as images, not become text.
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
        return true;
    }
    let mut prefix = [0; 32];
    fs::File::open(path)
        .and_then(|mut file| file.read(&mut prefix))
        .ok()
        .is_some_and(|len| image::guess_format(&prefix[..len]).is_ok())
}

pub(super) fn read_image(
    session_id: &str,
    turn_id: &str,
    call_id: &str,
    path: &Path,
) -> NativeToolResult {
    let file = fs::File::open(path).map_err(|e| image_error(format!("Cannot open image: {e}")))?;
    let metadata = file.metadata().map_err(|e| image_error(e.to_string()))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_SOURCE_BYTES {
        return Err(image_error(
            "Image must be a nonempty regular file no larger than 64 MiB.",
        ));
    }
    let mut source = Vec::new();
    file.take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut source)
        .map_err(|e| image_error(e.to_string()))?;
    if source.len() as u64 > MAX_SOURCE_BYTES {
        return Err(image_error("Image grew beyond the 64 MiB input limit."));
    }
    let mut reader = ImageReader::new(Cursor::new(source))
        .with_guessed_format()
        .map_err(|e| image_error(e.to_string()))?;
    let format = reader
        .format()
        .ok_or_else(|| image_error("Unrecognized image encoding."))?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif
    ) {
        return Err(image_error("Unsupported image encoding."));
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|e| image_error(format!("Cannot decode image: {e}")))?;
    let original = (decoded.width(), decoded.height());
    let mut image = if original.0 > MAX_EDGE || original.1 > MAX_EDGE {
        decoded.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Triangle)
    } else {
        decoded
    };
    // PNG keeps transparency and text. Bound the encoded payload too: noisy
    // RGBA images can exceed the provider byte limit even after dimension caps.
    let bytes = loop {
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, ImageFormat::Png)
            .map_err(|e| image_error(e.to_string()))?;
        let bytes = encoded.into_inner();
        if bytes.len() <= MAX_IMAGE_BYTES {
            break bytes;
        }
        image = image.resize(
            (image.width() * 3 / 4).max(1),
            (image.height() * 3 / 4).max(1),
            image::imageops::FilterType::Triangle,
        );
    };
    let artifact = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        &format!("{call_id}-image"),
        ToolArtifactKind::ImageEvidence,
        "png",
        "image/png",
        &bytes,
    )
    .ok_or_else(|| image_error("Cannot store model image evidence."))?;
    let evidence_path = artifact
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| image_error("Image evidence has no readable path."))?;
    let note = if matches!(
        format,
        ImageFormat::Gif | ImageFormat::WebP | ImageFormat::Png
    ) {
        " Static image only; if the source is animated, this shows its first frame, not the animation."
    } else {
        ""
    };
    Ok(NativeToolSuccess {
        content: format!(
            "Read image {} ({}×{}; model image {}×{}). Image content is attached directly for vision-capable models.{note}",
            path.display(),
            original.0,
            original.1,
            image.width(),
            image.height()
        ),
        raw: json!({"kind":"image_read", "sourcePath":path, "sourceBytes":metadata.len(),
            "originalWidth":original.0,"originalHeight":original.1,
            "width":image.width(),"height":image.height(),"frame":"first",
            "providerImage":{"path":evidence_path,"mediaType":"image/png","bytes":bytes.len()},
            "imageEvidenceRef":artifact,
            "imageArtifact":{"id":artifact["id"], "kind":"image", "mediaType":"image/png",
                "path":evidence_path, "width":image.width(), "height":image.height(),
                "openTarget":{"kind":"file","path":evidence_path,"mediaType":"image/png"}}}),
        recommended_next_action: None,
    })
}
