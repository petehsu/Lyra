export type WorkspaceCaptureLayer = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bitmap: Buffer;
  readonly bitmapWidth: number;
  readonly bitmapHeight: number;
};

const bytesPerPixel = 4;

export const blitBgra = (
  dest: Buffer,
  destWidth: number,
  destHeight: number,
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  originX: number,
  originY: number
): Buffer => {
  const output = Buffer.from(dest);
  for (let y = 0; y < sourceHeight; y += 1) {
    const destY = originY + y;
    if (destY < 0 || destY >= destHeight) {
      continue;
    }
    let srcX = 0;
    let destX = originX;
    let copyWidth = sourceWidth;
    if (destX < 0) {
      srcX = -destX;
      copyWidth -= srcX;
      destX = 0;
    }
    if (destX + copyWidth > destWidth) {
      copyWidth = destWidth - destX;
    }
    if (copyWidth <= 0) {
      continue;
    }
    source.copy(
      output,
      (destY * destWidth + destX) * bytesPerPixel,
      (y * sourceWidth + srcX) * bytesPerPixel,
      (y * sourceWidth + srcX) * bytesPerPixel +       copyWidth * bytesPerPixel
    );
  }
  return output;
};

export const paintWorkspaceLayers = (
  shell: Buffer,
  shellWidth: number,
  shellHeight: number,
  cssWidth: number,
  cssHeight: number,
  layers: readonly WorkspaceCaptureLayer[]
): Buffer => {
  const scaleX = shellWidth / Math.max(1, cssWidth);
  const scaleY = shellHeight / Math.max(1, cssHeight);
  let bitmap = shell;
  for (const layer of layers) {
    bitmap = blitBgra(
      bitmap,
      shellWidth,
      shellHeight,
      layer.bitmap,
      layer.bitmapWidth,
      layer.bitmapHeight,
      Math.round(layer.x * scaleX),
      Math.round(layer.y * scaleY)
    );
  }
  return bitmap;
};
