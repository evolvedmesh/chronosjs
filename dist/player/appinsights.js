import { decodeReplay, fromBase64 } from "../codec.js";
import { PARTS_PER_ITEM } from "../transports/appinsights.js";
/**
 * KQL that returns the rows of every replay in the time range, newest first.
 * Pass them to `assembleReplays()`.
 */
export const REPLAYS_KQL = `customEvents
| where name == "chronos.replay"
| extend id = tostring(customDimensions.chronosId), seq = toint(customDimensions.chronosSeq)
| project timestamp, id, seq, customDimensions, session_Id, user_Id, cloud_RoleName
| order by timestamp desc, id, seq asc`;
/** Group telemetry rows by replay and join their parts. */
export function assembleReplays(rows) {
    const groups = new Map();
    for (const row of rows) {
        const raw = "customDimensions" in row ? row.customDimensions : row;
        const dims = (typeof raw === "string" ? JSON.parse(raw) : raw);
        const id = dims.chronosId;
        if (!id)
            continue;
        const parts = groups.get(id) ?? new Map();
        groups.set(id, parts);
        parts.set(Number(dims.chronosSeq ?? 0), dims);
    }
    return Array.from(groups, ([id, parts]) => {
        const first = parts.get(0) ?? parts.values().next().value ?? {};
        const total = Number(first.chronosTotal ?? 1);
        const assembled = { id, received: parts.size, total, dimensions: first };
        if (parts.size === total) {
            let data = "";
            for (let seq = 0; seq < total; seq++) {
                const dims = parts.get(seq) ?? {};
                for (let part = 0; part < PARTS_PER_ITEM; part++)
                    data += dims[`d${part}`] ?? "";
            }
            assembled.data = { bytes: fromBase64(data), codec: first.chronosCodec ?? "deflate-raw" };
        }
        return assembled;
    });
}
/** Decode one assembled replay. */
export async function readAssembled(assembled) {
    if (!assembled.data)
        throw new Error(`chronosjs: replay ${assembled.id} has ${assembled.received} of ${assembled.total} parts`);
    return decodeReplay(assembled.data.bytes, assembled.data.codec);
}
//# sourceMappingURL=appinsights.js.map