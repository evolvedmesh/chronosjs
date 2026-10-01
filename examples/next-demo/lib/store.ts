import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assembleReplays } from "chronosjs/player";

/**
 * Where the demo keeps what the browser sends:
 * - `.data/replays/<id>.bin`: replays posted by `httpTransport`;
 * - `.data/appinsights.jsonl`: telemetry items posted to the mock
 *   Application Insights endpoint, one per line, shaped like `customEvents`.
 */
const DATA = process.env.DEMO_DATA_DIR ?? path.join(process.cwd(), ".data");
const REPLAYS = path.join(DATA, "replays");
const TELEMETRY = path.join(DATA, "appinsights.jsonl");

export type Source = "http" | "appinsights";

export interface TelemetryRow {
  timestamp: string;
  name: string;
  iKey: string;
  tags: Record<string, string>;
  customDimensions: Record<string, string>;
}

export interface ReplaySummary {
  id: string;
  source: Source;
  at: string;
  bytes: number;
  error?: string;
  items?: number;
  complete: boolean;
}

export const isReplayId = (id: string) => /^[0-9a-f]{32}$/.test(id);

export async function saveReplay(id: string, bytes: Uint8Array, codec: string) {
  await mkdir(REPLAYS, { recursive: true });
  await Bun.write(path.join(REPLAYS, `${id}.${codec === "json" ? "json" : "bin"}`), bytes);
}

export async function appendTelemetry(rows: TelemetryRow[]) {
  await mkdir(DATA, { recursive: true });
  await appendFile(TELEMETRY, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function telemetryRows(): Promise<TelemetryRow[]> {
  const file = Bun.file(TELEMETRY);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelemetryRow);
}

export async function listReplays(): Promise<ReplaySummary[]> {
  const out: ReplaySummary[] = [];
  const rows = await telemetryRows();
  for (const assembled of assembleReplays(rows)) {
    const first = rows.find(
      (row) => row.customDimensions.chronosId === assembled.id && row.customDimensions.chronosSeq === "0",
    );
    out.push({
      id: assembled.id,
      source: "appinsights",
      at: first?.timestamp ?? "",
      bytes: Number(assembled.dimensions.chronosBytes ?? 0),
      error: assembled.dimensions.chronosError,
      items: assembled.total,
      complete: !!assembled.data,
    });
  }
  const files = await readdir(REPLAYS).catch(() => [] as string[]);
  for (const file of files) {
    const id = file.split(".")[0];
    if (!isReplayId(id)) continue;
    const info = await stat(path.join(REPLAYS, file));
    out.push({ id, source: "http", at: info.mtime.toISOString(), bytes: info.size, complete: true });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** The encoded replay as stored, from either source. */
export async function readReplay(
  id: string,
  source: Source,
): Promise<{ bytes: Uint8Array; codec: string } | undefined> {
  if (!isReplayId(id)) return undefined;
  if (source === "appinsights") {
    const assembled = assembleReplays(
      (await telemetryRows()).filter((row) => row.customDimensions.chronosId === id),
    )[0];
    return assembled?.data ? { bytes: assembled.data.bytes, codec: assembled.data.codec } : undefined;
  }
  for (const [ext, codec] of [
    ["bin", "deflate-raw"],
    ["json", "json"],
  ] as const) {
    const file = Bun.file(path.join(REPLAYS, `${id}.${ext}`));
    if (await file.exists()) return { bytes: new Uint8Array(await file.arrayBuffer()), codec };
  }
  return undefined;
}
