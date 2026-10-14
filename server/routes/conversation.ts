import type { ConversationService } from "@server/conversation/service";
import { Hono } from "hono";
import { parseAfter, sseResponse } from "../sse.ts";


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
    const conversationSnapshot = await conversationService.snapshot(id);
    return ctx.json(conversationSnapshot);
  });

  conversationApp.post("/:conversationId/message", async (ctx) => {
    const formData = await ctx.req.formData();
    const { conversationId } = ctx.req.param();
    const userInput = formData.get("text") as string;
    await conversationService.send(conversationId, userInput);
    return ctx.json({ accepts: true }, 202);
  });

  conversationApp.get("/:conversationId/stream", (ctx) => {
    const { conversationId } = ctx.req.param();
    const channel = conversationService.getEventChannel(conversationId);
    const after = parseAfter(ctx.req.query("after"), channel);
    return sseResponse(channel, after);
  });

  return conversationApp;
}
