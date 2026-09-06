use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/media/generate_image",
            "media",
            "generate_image",
            "Generate image",
            "Generate an image with the configured default image model and save it as an artifact.",
            None,
        ),
        super::s(
            "/tools/media/generate_speech",
            "media",
            "generate_speech",
            "Generate speech",
            "Synthesize speech with the configured default speech model and save the audio artifact.",
            None,
        ),
        super::s(
            "/tools/media/transcribe_audio",
            "media",
            "transcribe_audio",
            "Transcribe audio",
            "Transcribe a local audio file with the configured transcription model.",
            None,
        ),
        super::s(
            "/tools/media/generate_video",
            "media",
            "generate_video",
            "Generate video",
            "Generate a video with the configured default video model and save it as an artifact.",
            None,
        ),
    ]
}
