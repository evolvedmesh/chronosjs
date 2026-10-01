"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { captureError, record, stopRecording } from "../index.js";
import { ChronosPlayer } from "../player/index.js";
/**
 * Starts recording when mounted (once per page), stops when unmounted. Put it
 * in the root layout. Options are read on the first mount only.
 */
export function ChronosRecorder(props) {
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
export function useChronosError(error, kind = "boundary") {
    useEffect(() => {
        if (error)
            captureError(error, kind);
    }, [error, kind]);
}
/** The replay player as a React component. */
export function ReplayPlayer({ replay, className, style, onReady, ...options }) {
    const ref = useRef(null);
    const optionsRef = useRef(options);
    const onReadyRef = useRef(onReady);
    useEffect(() => {
        if (!ref.current)
            return;
        const player = new ChronosPlayer(ref.current, replay, optionsRef.current);
        onReadyRef.current?.(player);
        return () => player.destroy();
    }, [replay]);
    return _jsx("div", { ref: ref, className: className, style: { width: "100%", height: "100%", ...style } });
}
export { captureError } from "../index.js";
//# sourceMappingURL=index.js.map