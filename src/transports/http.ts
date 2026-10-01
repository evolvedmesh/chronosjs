import type { Transport } from "./types.js";

export interface HttpTransportOptions {
  /** Absolute or same-origin URL that accepts `POST` with the encoded replay as the body. */
  url: string;
  headers?: Record<string, string>;
}

/**
 * Sends the encoded replay as is (`application/octet-stream`) to an endpoint
 * of your own. Headers: `x-chronos-id`, `x-chronos-codec`.
 */
export function httpTransport(options: HttpTransportOptions): Transport {
  const absolute = () => new URL(options.url, typeof location === "undefined" ? undefined : location.href).href;
  return {
    name: "http",
    ignores: (url) => {
      try {
        return new URL(url, location.href).href.split("?")[0] === absolute().split("?")[0];
      } catch {
        return false;
      }
    },
    async send(replay, encoded, context) {
      const response = await fetch(options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-chronos-id": replay.id,
          "x-chronos-codec": encoded.codec,
          ...options.headers,
        },
        body: encoded.bytes as BodyInit,
        keepalive: context.unloading && encoded.bytes.length < 60_000,
      });
      if (!response.ok) throw new Error(`chronosjs: ${options.url} answered ${response.status}`);
    },
  };
}
