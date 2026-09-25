import type { ConversationService } from "@server/conversation/service";
import { Hono } from "hono";
import type { StreamEvent } from "@shared/types.ts";


export function createConversationRoutes(
  conversationService: ConversationService,
) {
  const conversationApp = new Hono();

  conversationApp.post("/", async (ctx) => {
    const sessionManaged = await conversationService.createConversation();
    const snapshot = await conversationService.snapshot(sessionManaged.id);
    return ctx.json(snapshot);
  });

  conversationApp.post("/:id", async (ctx) => {
    const { id } = ctx.req.param();
    const conversationSnapshot = conversationService.snapshot(id);
    return ctx.json(conversationSnapshot);
  });

  conversationApp.post("/:conversationId/message", async (ctx) => {
    const formData = await ctx.req.formData();
    const { conversationId } = ctx.req.param();
    const userInput = formData.get("text") as string;
    await conversationService.send(conversationId, userInput);
    return ctx.json({ accepts: true }, 202);
  });

  conversationApp.post("/:conversationId/stream", (ctx) => {
    const { conversationId } = ctx.req.param();
    const afterQuery = ctx.req.query("after") ?? "0";
    const after =
      afterQuery === "latest"
        ? conversationService.getEventChannel(conversationId).lastId()
        : Number(afterQuery);
    let unsubscribe: () => void;
    let heartBeat: ReturnType<typeof setInterval> | undefined;
    const safteAfter = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    const channel = conversationService.getEventChannel(conversationId);
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (event: StreamEvent) => {
          controller.enqueue(
            encoder.encode(`data:${JSON.stringify(event)}\n\n`),
          );
        };
        const { events } = channel.replay(safteAfter);
        for (const event of events) {
          send(event);
        }
        unsubscribe = channel.subscirbe(send);
        heartBeat = setInterval(() => {
          controller.enqueue(encoder.encode(":keepalive\n\n"));
        }, 15000);
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
        "X-Accel-Buffering": "no",
      },
    });
  });

  return conversationApp;
}
