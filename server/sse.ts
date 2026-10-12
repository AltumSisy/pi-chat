import type { EventChannel } from "./conversation/channel.ts";
import type { StreamEvent } from "../shared/types.ts";

/**
 * Parse the `after` query parameter for SSE event replay.
 *
 * - `"latest"` → use the channel's last event ID (skip replay, live only)
 * - `"42"` → parse as integer, with a safety floor of 0
 * - `undefined` / `""` → defaults to 0 (replay everything)
 *
 * @param afterQuery - Raw query string from `ctx.req.query("after")`
 * @param channel - The EventChannel (used only for `"latest"` to get lastId)
 * @returns A safe, non‑negative integer event sequence ID
 */
export function parseAfter(
  afterQuery: string | undefined,
  channel: EventChannel,
): number {
  const raw = afterQuery ?? "0";
  if (raw === "latest") {
    return channel.lastId();
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Build a standard SSE (Server‑Sent Events) {@link Response} from an
 * {@link EventChannel}.
 *
 * ## What this encapsulates (the boilerplate you shouldn't rewrite)
 *
 * | Concern | Implementation |
 * |---------|----------------|
 * | Replay stored events newer than `after` | {@link EventChannel.replay} |
 * | Subscribe to live events | {@link EventChannel.subscribe} |
 * | SSE wire format | `data:<json>\n\n` via {@link TextEncoder} |
 * | Keepalive heartbeat | `:keepalive` comment every 15 s |
 * | Cleanup on disconnect | unsubscribe + clearInterval in `cancel` |
 * | Required HTTP headers | Cache-Control, Content-Type, Connection, X-Accel-Buffering |
 *
 * @param channel - The EventChannel to stream from
 * @param after  - Event sequence ID to replay from (events with `id > after`)
 * @returns A {@link Response} with a {@link ReadableStream} body, ready to return
 *          from a Hono route
 */
export function sseResponse(channel: EventChannel, after: number): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartBeat: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const send = (event: StreamEvent) => {
        controller.enqueue(
          encoder.encode(`data:${JSON.stringify(event)}\n\n`),
        );
      };

      // 1. Replay historical events (for reconnection)
      const { events } = channel.replay(after);
      for (const event of events) {
        send(event);
      }

      // 2. Subscribe to live events
      unsubscribe = channel.subscribe(send);

      // 3. Keepalive heartbeat — prevents proxy / nginx from closing idle connections
      heartBeat = setInterval(() => {
        controller.enqueue(encoder.encode(":keepalive\n\n"));
      }, 15_000);
    },

    cancel: () => {
      unsubscribe?.();
      if (heartBeat) {
        clearInterval(heartBeat);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache,no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
      "X-Accel-Buffering": "no",
    },
  });
}