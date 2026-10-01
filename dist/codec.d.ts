import type { Replay } from "./format.js";
/**
 * Encoded replay: JSON compressed with deflate-raw (no header), or plain JSON
 * prefixed with `{` where the browser has no CompressionStream. The first byte
 * tells them apart: deflate-raw output never starts with `{` followed by a
 * valid JSON document, and decode tries JSON only when the byte is `{`.
 */
export type Codec = "deflate-raw" | "json";
export declare function encodeReplay(replay: Replay): Promise<{
    bytes: Uint8Array;
    codec: Codec;
}>;
export declare function decodeReplay(bytes: Uint8Array, codec?: Codec): Promise<Replay>;
export declare function toBase64(bytes: Uint8Array): string;
export declare function fromBase64(text: string): Uint8Array;
