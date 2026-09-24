import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif'

export type MeasuredImage = {
  bytes: Uint8Array
  width: number
  height: number
  mime: ImageMime
}

/** Pixel size from the header of a PNG, JPEG or GIF. */
export const imageSize = (
  bytes: Uint8Array,
): { width: number; height: number; mime: ImageMime } | null => {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readU32(bytes, 16), height: readU32(bytes, 20), mime: 'image/png' }
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8), mime: 'image/gif' }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let index = 2
    while (index + 9 < bytes.length) {
      if (bytes[index] !== 0xff) return null
      const marker = bytes[index + 1]!
      const size = (bytes[index + 2]! << 8) | bytes[index + 3]!
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: (bytes[index + 5]! << 8) | bytes[index + 6]!,
          width: (bytes[index + 7]! << 8) | bytes[index + 8]!,
          mime: 'image/jpeg',
        }
      }
      index += 2 + size
    }
  }
  return null
}

const readU32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0

/** Local path or data URL. Remote http(s) addresses are refused before the file is opened. */
export const readLocalImage = async (url: string): Promise<MeasuredImage | { error: string }> => {
  if (/^https?:\/\//i.test(url)) return { error: 'remote images are not built in' }
  let bytes: Uint8Array
  if (url.startsWith('data:')) {
    const match = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(url)
    if (!match) return { error: 'unsupported image format (only png, jpg and gif can be embedded)' }
    bytes = new Uint8Array(Buffer.from(match[1]!, 'base64'))
  } else {
    try {
      bytes = new Uint8Array(await readFile(isAbsolute(url) ? url : resolve(url)))
    } catch {
      return { error: `image not found: ${url}` }
    }
  }
  const size = imageSize(bytes)
  if (!size) return { error: 'unsupported image format (only png, jpg and gif can be embedded)' }
  return { bytes, ...size }
}
