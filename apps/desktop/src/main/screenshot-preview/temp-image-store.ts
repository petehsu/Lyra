import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMP_DIR_NAME = "lyra-screenshot-preview";

const extensionForMimeType = (mimeType: "image/png" | "image/jpeg"): string =>
  mimeType === "image/jpeg" ? "jpg" : "png";

export const createScreenshotPreviewTempStore = () => {
  const rootDir = join(tmpdir(), TEMP_DIR_NAME);
  const filePathByPreviewId = new Map<string, string>();

  const ensureRoot = async (): Promise<void> => {
    await mkdir(rootDir, { recursive: true });
  };

  const writePreviewImage = async (
    previewId: string,
    imageBase64: string,
    mimeType: "image/png" | "image/jpeg"
  ): Promise<string> => {
    await ensureRoot();
    const filePath = join(
      rootDir,
      `${previewId}.${extensionForMimeType(mimeType)}`
    );
    await writeFile(filePath, Buffer.from(imageBase64, "base64"));
    filePathByPreviewId.set(previewId, filePath);
    return filePath;
  };

  const readPreviewFilePath = (previewId: string): string | null =>
    filePathByPreviewId.get(previewId) ?? null;

  const deletePreviewImage = async (previewId: string): Promise<void> => {
    const filePath = filePathByPreviewId.get(previewId);
    if (filePath === undefined) {
      return;
    }
    filePathByPreviewId.delete(previewId);
    await rm(filePath, { force: true });
  };

  const dispose = async (): Promise<void> => {
    const previewIds = [...filePathByPreviewId.keys()];
    await Promise.all(previewIds.map((previewId) => deletePreviewImage(previewId)));
    await rm(rootDir, { recursive: true, force: true });
  };

  return {
    writePreviewImage,
    readPreviewFilePath,
    deletePreviewImage,
    dispose
  };
};