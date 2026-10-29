import type { ConversationService } from "@server/conversation/service";
import { Hono } from "hono";
import { parseAfter, sseResponse } from "../sse.ts";
import { jsonBody } from "@server/utils";
import type { ConversationConfigUpdate } from "@shared/types.ts";

export function createConversationRoutes(
  conversationService: ConversationService,
) {
  const conversationApp = new Hono();

  /**
   * 创建新对话
   */
  conversationApp.post("/", async (ctx) => {
    const sessionManaged = await conversationService.createConversation();
    const snapshot = await conversationService.snapshot(sessionManaged.id);
    return ctx.json(snapshot);
  });

  /**
   * 获取旧对话
   */
  conversationApp.post("/:id", async (ctx) => {
    const { id } = ctx.req.param();
    const conversationSnapshot = await conversationService.snapshot(id);
    return ctx.json(conversationSnapshot);
  });

  /**
   * 获取会话列表
   */
  conversationApp.get("/", async (ctx) => {
    const conversationList = await conversationService.list();
    return ctx.json(conversationList);
  });

  /**
   * 删除会话
   */
  conversationApp.delete("/:conversationId", async (ctx) => {
    const { conversationId } = ctx.req.param();
    await conversationService.delete(conversationId);
    return ctx.json({
      deleted: true,
    });
  });

  /**
   * 会话编辑
   */
  conversationApp.patch("/:conversationId", async (ctx) => {
    const { conversationId } = ctx.req.param();

    const body = await jsonBody<{ title?: unknown }>(ctx.req.raw);
    if (typeof body.title !== "string")
      throw new Error("Title should be a valid string");
    const conversationSummary = await conversationService.rename(
      conversationId,
      body.title,
    );

    return ctx.json(conversationSummary);
  });

  /**
   * 会话终止
   */
  conversationApp.post("/:conversationId/abort", async (ctx) => {
    const { conversationId } = ctx.req.param();
    await conversationService.abort(conversationId);
    return ctx.json({
      aborted: true,
    });
  });

  /**
   * 创建会话
   */
  conversationApp.post("/:conversationId/message", async (ctx) => {
    const formData = await ctx.req.formData();
    const { conversationId } = ctx.req.param();
    const userInput = formData.get("text") as string;
    const skillsRaw = formData.get("skills") as string | null;
    // 没带 skills 字段 = 保持当前选择；带了就必须是合法的 name 数组
    let skills: string[] | undefined;
    if (skillsRaw !== null && skillsRaw !== "") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(skillsRaw);
      } catch {
        throw new Error("skills must be valid JSON");
      }
      if (!Array.isArray(parsed) || parsed.some((s) => typeof s !== "string"))
        throw new Error("skills must be a JSON array of skill names");
      skills = parsed;
    }
    await conversationService.send(conversationId, userInput, skills);
    return ctx.json({ accepts: true }, 202);
  });

  /**
   * 获取会话流
   */
  conversationApp.get("/:conversationId/stream", (ctx) => {
    const { conversationId } = ctx.req.param();
    const channel = conversationService.getEventChannel(conversationId);
    const after = parseAfter(ctx.req.query("after"), channel);
    return sseResponse(channel, after);
  });

  /**
   * 获取配置
   */
  conversationApp.get("/:conversationId/config", async (ctx) => {
    const { conversationId } = ctx.req.param();
    const conversationConfig =
      await conversationService.getConfig(conversationId);
    return ctx.json(conversationConfig);
  });

  /**
   * 变更配置（模型 / 推理强度 / 技能选择）
   */
  conversationApp.patch("/:conversationId/config", async (ctx) => {
    const { conversationId } = ctx.req.param();
    const body = await jsonBody<ConversationConfigUpdate>(ctx.req.raw);
    if (body.skills !== undefined) {
      if (
        !Array.isArray(body.skills) ||
        body.skills.some((skill) => typeof skill !== "string")
      )
        throw new Error("skills must be an array of skill names");
    }
    const updatedConfig = await conversationService.updateConfig(
      conversationId,
      body,
    );
    return ctx.json(updatedConfig);
  });

  return conversationApp;
}
