import Link from "next/link";
import { listReplays } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ReplaysPage() {
  const replays = await listReplays();
  return (
    <main className="page">
      <header className="replays-header">
        <h1>Replays</h1>
        <Link href="/">← Back to the shop</Link>
      </header>
      <p className="muted">
        Each error in the shop sends one replay twice: as Application Insights <code>customEvents</code> (to the mock
        ingestion endpoint) and as raw bytes to <code>/api/replays</code>.
      </p>
      {replays.length === 0 ? (
        <p className="panel">No replays yet. Go break something in the shop.</p>
      ) : (
        <table className="replays">
          <thead>
            <tr>
              <th>When</th>
              <th>Error</th>
              <th>Source</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {replays.map((replay) => (
              <tr key={`${replay.source}:${replay.id}`}>
                <td title={replay.at}>{new Date(replay.at).toLocaleString("en-GB")}</td>
                <td>{replay.error ?? <span className="muted">—</span>}</td>
                <td>
                  {replay.source === "appinsights"
                    ? `App Insights · ${replay.items} item${replay.items === 1 ? "" : "s"}`
                    : "HTTP"}
                </td>
                <td>{(replay.bytes / 1024).toFixed(1)} KB</td>
                <td>
                  {replay.complete ? (
                    <Link href={`/replays/${replay.id}?source=${replay.source}`}>Watch</Link>
                  ) : (
                    <span className="muted">incomplete</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
