"use client";

import { type Codec, decodeReplay, type Replay } from "chronosjs";
import { ReplayPlayer } from "chronosjs/react";
import { useEffect, useState } from "react";

/** Tests drive the player through `window.chronosPlayer`. */
function exposeForTests(player: unknown) {
  (window as unknown as { chronosPlayer: unknown }).chronosPlayer = player;
}

export function Viewer({ id, source }: { id: string; source: "http" | "appinsights" }) {
  const [replay, setReplay] = useState<Replay>();
  const [size, setSize] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(`/api/replays/${id}?source=${source}`);
      if (!response.ok) throw new Error(`The replay could not be loaded (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const decoded = await decodeReplay(bytes, (response.headers.get("x-chronos-codec") as Codec) ?? undefined);
      if (!cancelled) {
        setSize(bytes.length);
        setReplay(decoded);
      }
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (error) return <p className="alert">{error}</p>;
  if (!replay) return <p className="muted">Loading replay…</p>;
  return (
    <>
      <p className="muted replay-facts">
        {replay.reason ? <strong>{replay.reason.message}</strong> : null} ·{" "}
        {new Date(replay.ts).toLocaleString("en-GB")} · {replay.e.length} events · {(size / 1024).toFixed(1)} KB
        compressed · {(JSON.stringify(replay).length / 1024).toFixed(1)} KB as JSON
      </p>
      <div className="player-box">
        <ReplayPlayer replay={replay} autoplay onReady={exposeForTests} />
      </div>
    </>
  );
}
