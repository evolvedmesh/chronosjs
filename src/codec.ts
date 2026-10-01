import type { Replay } from "./format.js";

/**
 * Encoded replay: JSON compressed with deflate-raw (no header), or plain JSON
 * prefixed with `{` where the browser has no CompressionStream. The first byte
 * tells them apart: deflate-raw output never starts with `{` followed by a
 * valid JSON document, and decode tries JSON only when the byte is `{`.
 */
export type Codec = "deflate-raw" | "json";

const hasCompression = typeof CompressionStream !== "undefined";

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function encodeReplay(replay: Replay): Promise<{ bytes: Uint8Array; codec: Codec }> {
  const json = new TextEncoder().encode(JSON.stringify(replay));
  if (!hasCompression) return { bytes: json, codec: "json" };
  return { bytes: await pipe(json, new CompressionStream("deflate-raw")), codec: "deflate-raw" };
}

export async function decodeReplay(bytes: Uint8Array, codec?: Codec): Promise<Replay> {
  const plain = codec === "json" || (codec === undefined && looksLikeJson(bytes));
  const json = plain ? bytes : await pipe(bytes, new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(json)) as Replay;
}

function looksLikeJson(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0x7b) return false;
  try {
    JSON.parse(new TextDecoder().decode(bytes));
    return true;
  } catch {
    return false;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
