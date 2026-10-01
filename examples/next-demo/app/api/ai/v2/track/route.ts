import { appendTelemetry, type TelemetryRow } from "@/lib/store";

/**
 * A stand-in for the Application Insights ingestion endpoint
 * (`<IngestionEndpoint>/v2/track`), so the demo works without an Azure
 * resource. It checks what the real endpoint checks about an item's shape and
 * size, answers the same way, and stores items as `customEvents` rows.
 */
const MAX_PROPERTY = 8192;
const MAX_ITEM = 64 * 1024;

interface Envelope {
  name?: string;
  time?: string;
  iKey?: string;
  tags?: Record<string, string>;
  data?: { baseType?: string; baseData?: { name?: string; properties?: Record<string, string> } };
}

export async function POST(request: Request) {
  const text = await request.text();
  let items: Envelope[];
  try {
    const parsed = JSON.parse(text);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // The SDK may also send newline-delimited JSON.
    items = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const errors: { index: number; statusCode: number; message: string }[] = [];
  const rows: TelemetryRow[] = [];
  items.forEach((item, index) => {
    const properties = item.data?.baseData?.properties ?? {};
    const problem =
      !item.iKey || !item.name || !item.time
        ? "missing iKey, name or time"
        : item.data?.baseType !== "EventData"
          ? "only EventData is stored by this mock"
          : JSON.stringify(item).length > MAX_ITEM
            ? "item larger than 64 KB"
            : Object.values(properties).some((value) => String(value).length > MAX_PROPERTY)
              ? "property longer than 8192 characters"
              : undefined;
    if (problem) {
      errors.push({ index, statusCode: 400, message: problem });
      return;
    }
    rows.push({
      timestamp: item.time as string,
      name: item.data?.baseData?.name ?? "",
      iKey: item.iKey as string,
      tags: item.tags ?? {},
      customDimensions: properties,
    });
  });
  if (rows.length) await appendTelemetry(rows);
  return Response.json(
    { itemsReceived: items.length, itemsAccepted: rows.length, errors },
    { status: errors.length ? (rows.length ? 206 : 400) : 200 },
  );
}
