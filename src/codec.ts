import type { Replay } from "./format.js";

/**
 * Encoded replay: JSON compressed with deflate-raw (no header), or plain JSON
 * prefixed with `{` where the browser has no CompressionStream. The first byte
 * tells them apart: deflate-raw output never starts with `{` followed by a
 * valid JSON document, and decode tries JSON only when the byte is `{`.
 */
export type Codec = "deflate-raw" | "json";

const hasCompression = typeof CompressionStream !== "undefined";

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`chronosjs: the replay is larger than ${maxBytes} bytes when decoded`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export interface DecodeOptions {
  /** Decoded (JSON) size allowed, at most: replays are untrusted input. Default 64 MB. */
  maxBytes?: number;
}

export async function encodeReplay(replay: Replay): Promise<{ bytes: Uint8Array; codec: Codec }> {
  const json = new TextEncoder().encode(JSON.stringify(replay));
  if (!hasCompression) return { bytes: json, codec: "json" };
  return { bytes: await pipe(json, new CompressionStream("deflate-raw")), codec: "deflate-raw" };
}

export async function decodeReplay(bytes: Uint8Array, codec?: Codec, options: DecodeOptions = {}): Promise<Replay> {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const plain = codec === "json" || (codec === undefined && looksLikeJson(bytes));
  if (plain && bytes.length > maxBytes) throw new Error(`chronosjs: the replay is larger than ${maxBytes} bytes`);
  const json = plain ? bytes : await pipe(bytes, new DecompressionStream("deflate-raw"), maxBytes);
  const replay = JSON.parse(new TextDecoder().decode(json)) as Replay;
  if (replay?.v !== 1 || !Array.isArray(replay.e)) throw new Error("chronosjs: not a version 1 replay");
  return replay;
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
