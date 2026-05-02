import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

type Rgba = readonly [number, number, number, number];

type PngImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..", "..");
const sourceLogoPath = join(rootDir, "apps", "desktop", "src", "renderer", "assets", "logo.png");
const iconRoot = join(rootDir, "apps", "desktop", "resources", "icons");
const appIconDir = join(iconRoot, "app");
const macIconDir = join(iconRoot, "macos");
const macIconsetDir = join(macIconDir, "lyra.iconset");
const winIconDir = join(iconRoot, "win");
const linuxIconDir = join(iconRoot, "linux");

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}

const ensureDir = (path: string): void => {
  mkdirSync(path, { recursive: true });
};

const assertPngSignature = (buffer: Buffer): void => {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) === false) {
    throw new Error("input is not a PNG file");
  }
};

const paethPredictor = (left: number, above: number, upperLeft: number): number => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (aboveDistance <= upperLeftDistance) {
    return above;
  }
  return upperLeft;
};

const decodePng = (path: string): PngImage => {
  const buffer = readFileSync(path);
  assertPngSignature(buffer);

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const chunkData = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (chunkType === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
      continue;
    }
    if (chunkType === "IDAT") {
      idatChunks.push(chunkData);
      continue;
    }
    if (chunkType === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0) {
    throw new Error("PNG is missing IHDR dimensions");
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`expected 8-bit RGBA PNG, got bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = new Uint8Array(width * height * bytesPerPixel);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowStart = y * rowLength;
    const previousRowStart = (y - 1) * rowLength;

    for (let x = 0; x < rowLength; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[previousRowStart + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[previousRowStart + x - bytesPerPixel]
        : 0;

      let value = raw;
      if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + above;
      } else if (filter === 3) {
        value = raw + Math.floor((left + above) / 2);
      } else if (filter === 4) {
        value = raw + paethPredictor(left, above, upperLeft);
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter: ${filter}`);
      }
      pixels[rowStart + x] = value & 0xff;
    }
    sourceOffset += rowLength;
  }

  return { width, height, data: pixels };
};

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createChunk = (type: string, data: Buffer = Buffer.alloc(0)): Buffer => {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
};

const encodePng = ({ width, height, data }: PngImage): Buffer => {
  const rowLength = width * 4;
  const scanlines = Buffer.alloc((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowLength + 1);
    scanlines[rowOffset] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * rowLength, rowLength)
      .copy(scanlines, rowOffset + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    createChunk("IEND")
  ]);
};

const pointInsideRoundedRect = (
  x: number,
  y: number,
  inset: number,
  size: number,
  radius: number
): boolean => {
  const min = inset;
  const max = size - inset;
  if (x < min || x > max || y < min || y > max) {
    return false;
  }
  const clampedX = Math.min(Math.max(x, min + radius), max - radius);
  const clampedY = Math.min(Math.max(y, min + radius), max - radius);
  const dx = x - clampedX;
  const dy = y - clampedY;
  return dx * dx + dy * dy <= radius * radius;
};

const roundedRectCoverage = (
  x: number,
  y: number,
  inset: number,
  size: number,
  radius: number
): number => {
  let covered = 0;
  const samples = 4;
  for (let sampleY = 0; sampleY < samples; sampleY += 1) {
    for (let sampleX = 0; sampleX < samples; sampleX += 1) {
      const px = x + (sampleX + 0.5) / samples;
      const py = y + (sampleY + 0.5) / samples;
      if (pointInsideRoundedRect(px, py, inset, size, radius)) {
        covered += 1;
      }
    }
  }
  return covered / (samples * samples);
};

const sampleAlphaBilinear = (image: PngImage, x: number, y: number): number => {
  const clampedX = Math.min(Math.max(x, 0), image.width - 1);
  const clampedY = Math.min(Math.max(y, 0), image.height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const index = (px: number, py: number): number => (py * image.width + px) * 4 + 3;
  const a00 = image.data[index(x0, y0)];
  const a10 = image.data[index(x1, y0)];
  const a01 = image.data[index(x0, y1)];
  const a11 = image.data[index(x1, y1)];
  const top = a00 * (1 - tx) + a10 * tx;
  const bottom = a01 * (1 - tx) + a11 * tx;
  return top * (1 - ty) + bottom * ty;
};

const blendPixel = (
  data: Uint8Array,
  index: number,
  color: Rgba,
  opacity: number
): void => {
  const sourceAlpha = Math.min(1, Math.max(0, (color[3] / 255) * opacity));
  const targetAlpha = data[index + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) {
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
    data[index + 3] = 0;
    return;
  }
  data[index] = Math.round(
    (color[0] * sourceAlpha + data[index] * targetAlpha * (1 - sourceAlpha)) / outAlpha
  );
  data[index + 1] = Math.round(
    (color[1] * sourceAlpha + data[index + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha
  );
  data[index + 2] = Math.round(
    (color[2] * sourceAlpha + data[index + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha
  );
  data[index + 3] = Math.round(outAlpha * 255);
};

const createRoundedAppIcon = (
  sourceLogo: PngImage,
  background: Rgba,
  foreground: Rgba
): PngImage => {
  const size = 1024;
  const data = new Uint8Array(size * size * 4);
  const inset = Math.round(size * 0.0625);
  const radius = Math.round(size * 0.205);
  const logoSize = Math.round(size * 0.64);
  const logoLeft = Math.round((size - logoSize) / 2);
  const logoTop = Math.round((size - logoSize) / 2);
  const logoScale = logoSize / Math.max(sourceLogo.width, sourceLogo.height);
  const scaledLogoWidth = sourceLogo.width * logoScale;
  const scaledLogoHeight = sourceLogo.height * logoScale;
  const logoOffsetX = logoLeft + (logoSize - scaledLogoWidth) / 2;
  const logoOffsetY = logoTop + (logoSize - scaledLogoHeight) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const coverage = roundedRectCoverage(x, y, inset, size, radius);
      if (coverage > 0) {
        blendPixel(data, index, background, coverage);
      }

      const sourceX = (x + 0.5 - logoOffsetX) / logoScale - 0.5;
      const sourceY = (y + 0.5 - logoOffsetY) / logoScale - 0.5;
      if (
        sourceX >= 0
        && sourceY >= 0
        && sourceX <= sourceLogo.width - 1
        && sourceY <= sourceLogo.height - 1
      ) {
        const alpha = sampleAlphaBilinear(sourceLogo, sourceX, sourceY) / 255;
        if (alpha > 0) {
          blendPixel(data, index, foreground, alpha);
        }
      }
    }
  }

  return { width: size, height: size, data };
};

const sampleBilinear = (
  image: PngImage,
  x: number,
  y: number,
  channel: number
): number => {
  const clampedX = Math.min(Math.max(x, 0), image.width - 1);
  const clampedY = Math.min(Math.max(y, 0), image.height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const index = (px: number, py: number): number => (py * image.width + px) * 4 + channel;
  const p00 = image.data[index(x0, y0)];
  const p10 = image.data[index(x1, y0)];
  const p01 = image.data[index(x0, y1)];
  const p11 = image.data[index(x1, y1)];
  const top = p00 * (1 - tx) + p10 * tx;
  const bottom = p01 * (1 - tx) + p11 * tx;
  return top * (1 - ty) + bottom * ty;
};

const resizeImage = (image: PngImage, width: number, height: number = width): PngImage => {
  const data = new Uint8Array(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const sourceY = (y + 0.5) * scaleY - 0.5;
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        data[index + channel] = Math.round(sampleBilinear(image, sourceX, sourceY, channel));
      }
    }
  }
  return { width, height, data };
};

const writePng = (path: string, image: PngImage): void => {
  ensureDir(dirname(path));
  writeFileSync(path, encodePng(image));
};

const writeMacIconset = (lightIcon: PngImage): void => {
  ensureDir(macIconsetDir);
  const entries = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024]
  ] as const;
  for (const [fileName, size] of entries) {
    writePng(join(macIconsetDir, fileName), resizeImage(lightIcon, size));
  }
};

const createIcnsBlock = (type: string, data: Buffer): Buffer => {
  const block = Buffer.alloc(8 + data.length);
  block.write(type, 0, 4, "ascii");
  block.writeUInt32BE(block.length, 4);
  data.copy(block, 8);
  return block;
};

const writeIcns = (path: string, sourceIcon: PngImage): void => {
  ensureDir(dirname(path));
  const entries = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512]
  ] as const;
  const blocks = entries.map(([type, size]) =>
    createIcnsBlock(type, encodePng(resizeImage(sourceIcon, size)))
  );
  const totalLength = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  writeFileSync(path, Buffer.concat([header, ...blocks]));
};

const writeMacIcons = (lightIcon: PngImage): void => {
  writeMacIconset(lightIcon);
  writeIcns(join(macIconDir, "lyra.icns"), lightIcon);
};

const writeIco = (path: string, sourceIcon: PngImage): void => {
  ensureDir(dirname(path));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = sizes.map((size) => encodePng(resizeImage(sourceIcon, size)));
  const headerSize = 6 + sizes.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  let imageOffset = headerSize;
  for (let i = 0; i < sizes.length; i += 1) {
    const entryOffset = 6 + i * 16;
    const size = sizes[i];
    const pngBuffer = pngBuffers[i];
    header[entryOffset] = size >= 256 ? 0 : size;
    header[entryOffset + 1] = size >= 256 ? 0 : size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(pngBuffer.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += pngBuffer.length;
  }

  writeFileSync(path, Buffer.concat([header, ...pngBuffers]));
};

const writeLinuxIcons = (sourceIcon: PngImage): void => {
  ensureDir(linuxIconDir);
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    writePng(join(linuxIconDir, `${size}x${size}.png`), resizeImage(sourceIcon, size));
  }
};

const main = (): void => {
  if (existsSync(sourceLogoPath) === false) {
    throw new Error(`logo source not found: ${sourceLogoPath}`);
  }

  const sourceLogo = decodePng(sourceLogoPath);
  const lightIcon = createRoundedAppIcon(sourceLogo, [255, 255, 255, 255], [0, 0, 0, 255]);
  const darkIcon = createRoundedAppIcon(sourceLogo, [0, 0, 0, 255], [255, 255, 255, 255]);

  writePng(join(appIconDir, "lyra-app-icon-light-1024.png"), lightIcon);
  writePng(join(appIconDir, "lyra-app-icon-dark-1024.png"), darkIcon);
  writePng(join(appIconDir, "lyra-app-icon-light-512.png"), resizeImage(lightIcon, 512));
  writePng(join(appIconDir, "lyra-app-icon-dark-512.png"), resizeImage(darkIcon, 512));
  writeMacIcons(lightIcon);
  writeIco(join(winIconDir, "lyra.ico"), lightIcon);
  writeLinuxIcons(lightIcon);

  console.info("generated Lyra app icon assets:");
  console.info(`  app:   ${appIconDir}`);
  console.info(`  mac:   ${join(macIconDir, "lyra.icns")}`);
  console.info(`  win:   ${join(winIconDir, "lyra.ico")}`);
  console.info(`  linux: ${linuxIconDir}`);
};

main();
