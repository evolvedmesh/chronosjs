"use client";

import { useChronosError } from "chronosjs/react";

export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Errors an error boundary catches never reach window.onerror: report it.
  useChronosError(error);
  return (
    <div className="panel narrow">
      <h1>Something went wrong</h1>
      <p className="alert" role="alert">
        {error.message}
      </p>
      <button type="button" className="primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
