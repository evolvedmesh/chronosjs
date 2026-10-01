import Link from "next/link";
import { Viewer } from "./viewer";

export default async function ReplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { id } = await params;
  const { source } = await searchParams;
  return (
    <main className="viewer-page">
      <header className="replays-header">
        <h1>Replay {id.slice(0, 8)}</h1>
        <Link href="/replays">← All replays</Link>
      </header>
      <Viewer id={id} source={source === "http" ? "http" : "appinsights"} />
    </main>
  );
}
