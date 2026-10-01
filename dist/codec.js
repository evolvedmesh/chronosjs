const hasCompression = typeof CompressionStream !== "undefined";
async function pipe(bytes, stream) {
    const body = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(body).arrayBuffer());
}
export async function encodeReplay(replay) {
    const json = new TextEncoder().encode(JSON.stringify(replay));
    if (!hasCompression)
        return { bytes: json, codec: "json" };
    return { bytes: await pipe(json, new CompressionStream("deflate-raw")), codec: "deflate-raw" };
}
export async function decodeReplay(bytes, codec) {
    const plain = codec === "json" || (codec === undefined && looksLikeJson(bytes));
    const json = plain ? bytes : await pipe(bytes, new DecompressionStream("deflate-raw"));
    return JSON.parse(new TextDecoder().decode(json));
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