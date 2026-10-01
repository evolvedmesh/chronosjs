"use client";

import { appInsightsTransport, httpTransport, record, stopRecording } from "chronosjs";
import { useEffect } from "react";

/**
 * Records the shop. Replays go to Application Insights (the mock endpoint in
 * this app, unless NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING names a real
 * resource) and, for comparison, as raw bytes to /api/replays.
 */
export function Recorder() {
  useEffect(() => {
    const connectionString =
      process.env.NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING ??
      `InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=${location.origin}/api/ai`;
    record({
      meta: { app: "next-demo", release: "1.0.0", sessionId: sessionId() },
      transports: [
        appInsightsTransport({ connectionString, roleName: "next-demo" }),
        httpTransport({ url: "/api/replays" }),
      ],
      // The visual comparison test turns masking off, so live and replayed fields show the same text.
      privacy: { maskInputs: !unmasked() },
      onReplay: (replay, bytes) => console.info(`chronos: sent replay ${replay.id} (${bytes} bytes)`),
    });
    return () => stopRecording();
  }, []);
  return null;
}

function unmasked(): boolean {
  try {
    return sessionStorage.getItem("demo:unmask") === "1";
  } catch {
    return false;
  }
}

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem("demo:session");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("demo:session", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
