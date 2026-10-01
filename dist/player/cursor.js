/**
 * The cursor is not recorded (that would be most of a replay's size). The
 * player knows where each click landed and when, and draws a cursor that
 * glides to it the way a hand would: it waits, leaves shortly before the
 * click, follows a gentle arc with a minimum-jerk speed profile, and arrives
 * just before the button goes down.
 */
const ARRIVE_EARLY_MS = 90;
const MIN_MOVE_MS = 260;
const MAX_MOVE_MS = 1100;
const RIPPLE_MS = 520;
/** Minimum-jerk profile: smooth start, smooth stop, like a reaching hand. */
function minimumJerk(p) {
    return p * p * p * (10 - 15 * p + 6 * p * p);
}
export class CursorPath {
    keys;
    segments = [];
    constructor(keys) {
        this.keys = keys;
        if (!keys.length)
            return;
        // Before the first known position the cursor is not shown: where it was is unknown.
        let from = keys[0];
        keys.forEach((to, index) => {
            const available = Math.max(0, to.t - from.t);
            const distance = Math.hypot(to.x - from.x, to.y - from.y);
            let duration = Math.min(MAX_MOVE_MS, Math.max(MIN_MOVE_MS, 220 + distance * 0.55));
            const early = Math.min(ARRIVE_EARLY_MS, available * 0.1);
            duration = Math.min(duration, Math.max(0, available - early));
            const arrive = to.t - early;
            // Bend the path a little, alternating sides, like a wrist pivoting.
            const side = index % 2 ? 1 : -1;
            const nx = distance ? -(to.y - from.y) / distance : 0;
            const ny = distance ? (to.x - from.x) / distance : 0;
            const bend = Math.min(80, distance * 0.16) * side;
            this.segments.push({
                from,
                to,
                depart: arrive - duration,
                arrive,
                cx: (from.x + to.x) / 2 + nx * bend,
                cy: (from.y + to.y) / 2 + ny * bend,
            });
            from = to;
        });
    }
    at(t) {
        const frame = { x: 0, y: 0, visible: false, ripple: -1, rippleX: 0, rippleY: 0 };
        if (!this.segments.length)
            return frame;
        frame.visible = t >= this.keys[0].t;
        // The segment in progress, or the last one finished.
        let segment = this.segments[0];
        for (const candidate of this.segments) {
            if (candidate.depart > t)
                break;
            segment = candidate;
        }
        if (t <= segment.depart) {
            frame.x = segment.from.x;
            frame.y = segment.from.y;
        }
        else if (t >= segment.arrive) {
            frame.x = segment.to.x;
            frame.y = segment.to.y;
        }
        else {
            const p = minimumJerk((t - segment.depart) / (segment.arrive - segment.depart));
            const q = 1 - p;
            frame.x = q * q * segment.from.x + 2 * q * p * segment.cx + p * p * segment.to.x;
            frame.y = q * q * segment.from.y + 2 * q * p * segment.cy + p * p * segment.to.y;
        }
        for (const key of this.keys) {
            if (key.t > t)
                break;
            if (key.click !== false && t - key.t < RIPPLE_MS) {
                frame.ripple = (t - key.t) / RIPPLE_MS;
                frame.rippleX = key.x;
                frame.rippleY = key.y;
            }
        }
        return frame;
    }
}
//# sourceMappingURL=cursor.js.map