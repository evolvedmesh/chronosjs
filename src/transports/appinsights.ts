import { toBase64 } from "../codec.js";
import type { Replay } from "../format.js";
import type { EncodedReplay, SendContext, Transport } from "./types.js";

/**
 * Application Insights limits that shape a replay upload:
 * - a property value holds at most 8,192 characters;
 * - one telemetry item should stay under 64 KB.
 * A replay is sent as one or more `customEvents` named `chronos.replay`,
 * each carrying up to 7 base64 parts of 8,000 characters (`d0`…`d6`).
 */
export const EVENT_NAME = "chronos.replay";
export const PART_CHARS = 8000;
export const PARTS_PER_ITEM = 7;
const SDK_VERSION = "chronosjs:0.2.0";

/** The part of the Application Insights web SDK the transport needs. */
export interface AppInsightsSdk {
  trackEvent(event: { name: string }, properties?: Record<string, unknown>): void;
  flush?(async?: boolean): void;
}

export interface AppInsightsOptions {
  /**
   * The resource's connection string. Required unless `sdk` is given.
   * `IngestionEndpoint` may point at a proxy on your own domain (ad blockers
   * sometimes block the Azure endpoint).
   */
  connectionString?: string;
  /**
   * An `ApplicationInsights` instance the app already runs. Replays then go
   * through it, so they get its session, user and operation ids and its
   * telemetry initializers (redaction rules) apply to them too.
   */
  sdk?: AppInsightsSdk;
  /** `cloud_RoleName` when sending directly. */
  roleName?: string;
  /** Session and user ids when sending directly. */
  context?: () => { sessionId?: string; userId?: string; operationId?: string };
}

interface ConnectionString {
  instrumentationKey: string;
  ingestionEndpoint: string;
}

export function parseConnectionString(value: string): ConnectionString {
  const parts = Object.fromEntries(
    value
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf("=");
        return [part.slice(0, at).toLowerCase(), part.slice(at + 1)];
      }),
  );
  const instrumentationKey = parts.instrumentationkey;
  if (!instrumentationKey) throw new Error("chronosjs: the connection string has no InstrumentationKey");
  const ingestionEndpoint = (parts.ingestionendpoint ?? "https://dc.services.visualstudio.com").replace(/\/+$/, "");
  return { instrumentationKey, ingestionEndpoint };
}

/** The custom properties of each telemetry item a replay is split into. */
export function replayItems(replay: Replay, encoded: EncodedReplay): Record<string, string>[] {
  const data = toBase64(encoded.bytes);
  const perItem = PART_CHARS * PARTS_PER_ITEM;
  const total = Math.max(1, Math.ceil(data.length / perItem));
  const items: Record<string, string>[] = [];
  for (let seq = 0; seq < total; seq++) {
    const chunk = data.slice(seq * perItem, (seq + 1) * perItem);
    const properties: Record<string, string> = {
      chronosId: replay.id,
      chronosSeq: String(seq),
      chronosTotal: String(total),
      chronosCodec: encoded.codec,
      chronosVersion: String(replay.v),
    };
    if (seq === 0) {
      properties.chronosBytes = String(encoded.bytes.length);
      properties.chronosStart = new Date(replay.ts).toISOString();
      if (replay.reason) {
        properties.chronosErrorKind = replay.reason.kind;
        properties.chronosError = replay.reason.message;
      }
    }
    for (let part = 0; part * PART_CHARS < chunk.length; part++) {
      properties[`d${part}`] = chunk.slice(part * PART_CHARS, (part + 1) * PART_CHARS);
    }
    items.push(properties);
  }
  return items;
}

export function appInsightsTransport(options: AppInsightsOptions): Transport {
  const { sdk } = options;
  const connection = options.connectionString ? parseConnectionString(options.connectionString) : undefined;
  if (!sdk && !connection) throw new Error("chronosjs: appInsightsTransport needs a connectionString or an sdk");
  const trackUrl = connection ? `${connection.ingestionEndpoint}/v2/track` : "";

  return {
    name: "appinsights",
    ignores: (url) =>
      (trackUrl !== "" && url.startsWith(connection?.ingestionEndpoint ?? "\0")) || url.includes("/v2/track"),
    async send(replay, encoded, context: SendContext) {
      const items = replayItems(replay, encoded);
      if (sdk) {
        for (const properties of items) sdk.trackEvent({ name: EVENT_NAME }, properties);
        sdk.flush?.(!context.unloading);
        return;
      }
      if (!connection) return;
      const ids = options.context?.() ?? {};
      const tags: Record<string, string> = {
        "ai.internal.sdkVersion": SDK_VERSION,
        "ai.operation.id": ids.operationId ?? replay.id,
        "ai.operation.name": replayPath(replay),
      };
      const sessionId = ids.sessionId ?? replay.meta.sessionId;
      const userId = ids.userId ?? replay.meta.userId;
      if (sessionId) tags["ai.session.id"] = sessionId;
      if (userId) tags["ai.user.id"] = userId;
      if (options.roleName ?? replay.meta.app) tags["ai.cloud.role"] = (options.roleName ?? replay.meta.app) as string;
      if (replay.meta.release) tags["ai.application.ver"] = replay.meta.release;
      const iKey = connection.instrumentationKey;
      const time = new Date().toISOString();
      const envelopes = items.map((properties) => ({
        name: `Microsoft.ApplicationInsights.${iKey.replace(/-/g, "")}.Event`,
        time,
        iKey,
        tags,
        data: { baseType: "EventData", baseData: { ver: 2, name: EVENT_NAME, properties } },
      }));
      // One item per request while unloading: keepalive bodies are capped at 64 KB in total.
      const batches = context.unloading ? envelopes.map((envelope) => [envelope]) : [envelopes];
      for (const batch of batches) {
        const body = JSON.stringify(batch);
        const response = await fetch(trackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: context.unloading && body.length < 60_000,
        });
        if (!response.ok && response.status !== 206) {
          throw new Error(`chronosjs: Application Insights answered ${response.status}`);
        }
      }
    },
  };
}

function replayPath(replay: Replay): string {
  for (const event of replay.e) {
    if (event[1] === 0 && typeof event[2] === "string") {
      try {
        return new URL(event[2]).pathname;
      } catch {
        return event[2];
      }
    }
  }
  return "/";
}
