import { isReplayId, listReplays, saveReplay } from "@/lib/store";

const MAX_BYTES = 2_000_000;

/** Receives replays from `httpTransport`. */
export async function POST(request: Request) {
  const id = request.headers.get("x-chronos-id") ?? "";
  const codec = request.headers.get("x-chronos-codec") ?? "deflate-raw";
  if (!isReplayId(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return Response.json({ error: "bad size" }, { status: 413 });
  await saveReplay(id, bytes, codec);
  return new Response(null, { status: 204 });
}

export async function GET() {
  return Response.json(await listReplays());
}
