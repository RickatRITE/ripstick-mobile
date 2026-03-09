/**
 * Image processing utilities for RipStick mobile.
 * Handles WebP conversion via Canvas API and filename generation
 * via the shared asset-filename module.
 */

import { generateAssetFilename } from '../../shared/asset-filename';

/**
 * Convert an image File/Blob to WebP format using Canvas API.
 * Returns the WebP bytes as a Uint8Array.
 */
export async function convertToWebP(file: Blob, quality = 0.9): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
  const buffer = await webpBlob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Process a shared/attached image file:
 * 1. Read original bytes (for hashing — matches desktop behavior)
 * 2. Convert to WebP
 * 3. Generate filename using the shared algorithm
 *
 * Returns the asset filename and WebP bytes ready for upload.
 */
export async function processImage(file: Blob): Promise<{
  filename: string;
  webpBytes: Uint8Array;
  originalSize: number;
  webpSize: number;
}> {
  // Read original bytes for hashing (same as desktop: hash input, not output)
  const originalBuffer = await file.arrayBuffer();
  const originalBytes = new Uint8Array(originalBuffer);

  const webpBytes = await convertToWebP(file);
  const filename = await generateAssetFilename(originalBytes);

  return {
    filename,
    webpBytes,
    originalSize: originalBytes.length,
    webpSize: webpBytes.length,
  };
}

/** Convert a Uint8Array to a base64 string (for GitHub API upload). */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
