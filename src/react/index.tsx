"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import type { Replay } from "../format.js";
import { captureError, type RecorderOptions, record, stopRecording } from "../index.js";
import { ChronosPlayer, type PlayerOptions } from "../player/index.js";

/**
 * Starts recording when mounted (once per page), stops when unmounted. Put it
 * in the root layout. Options are read on the first mount only.
 */
export function ChronosRecorder(props: RecorderOptions): null {
  const options = useRef(props);
  useEffect(() => {
    record(options.current);
    return () => stopRecording();
  }, []);
  return null;
}

/**
 * Reports an error a boundary caught (Next.js `error.tsx`, React error
 * boundaries), which the browser never sees as uncaught.
 */
export function useChronosError(error: unknown, kind = "boundary"): void {
  useEffect(() => {
    if (error) captureError(error, kind);
  }, [error, kind]);
}

export interface ReplayPlayerProps extends PlayerOptions {
  replay: Replay;
  className?: string;
  style?: CSSProperties;
  onReady?: (player: ChronosPlayer) => void;
}

/** The replay player as a React component. */
export function ReplayPlayer({ replay, className, style, onReady, ...options }: ReplayPlayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    if (!ref.current) return;
    const player = new ChronosPlayer(ref.current, replay, optionsRef.current);
    onReadyRef.current?.(player);
    return () => player.destroy();
  }, [replay]);
  return <div ref={ref} className={className} style={{ width: "100%", height: "100%", ...style }} />;
}

export { captureError } from "../index.js";
