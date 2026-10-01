import { readReplay, type Source } from "@/lib/store";

/** The encoded replay, from the http store or reassembled from the telemetry items. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source: Source = new URL(request.url).searchParams.get("source") === "http" ? "http" : "appinsights";
  const replay = await readReplay(id, source);
  if (!replay) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(replay.bytes as BodyInit, {
    headers: { "Content-Type": "application/octet-stream", "x-chronos-codec": replay.codec },
  });
}
