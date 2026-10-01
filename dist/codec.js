const hasCompression = typeof CompressionStream !== "undefined";
async function pipe(bytes, stream, maxBytes = Number.POSITIVE_INFINITY) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
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
export async function encodeReplay(replay) {
    const json = new TextEncoder().encode(JSON.stringify(replay));
    if (!hasCompression)
        return { bytes: json, codec: "json" };
    return { bytes: await pipe(json, new CompressionStream("deflate-raw")), codec: "deflate-raw" };
}
export async function decodeReplay(bytes, codec, options = {}) {
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    const plain = codec === "json" || (codec === undefined && looksLikeJson(bytes));
    if (plain && bytes.length > maxBytes)
        throw new Error(`chronosjs: the replay is larger than ${maxBytes} bytes`);
    const json = plain ? bytes : await pipe(bytes, new DecompressionStream("deflate-raw"), maxBytes);
    const replay = JSON.parse(new TextDecoder().decode(json));
    if (replay?.v !== 1 || !Array.isArray(replay.e))
        throw new Error("chronosjs: not a version 1 replay");
    return replay;
}
function looksLikeJson(bytes) {
    if (bytes[0] !== 0x7b)
        return false;
    try {
        JSON.parse(new TextDecoder().decode(bytes));
        return true;
    }
    catch {
        return false;
    }
}
export function toBase64(bytes) {
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
}
export function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
//# sourceMappingURL=codec.js.map