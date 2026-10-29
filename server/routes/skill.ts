import type { ConversationService } from "@server/conversation/service";
import { Hono } from "hono";

export function createSkillRoutes(conversationService: ConversationService) {
  const skillApp = new Hono();

  /**
   * 列出 skillsDir 下可用的技能
   * 返回 { skills, warnings }，warnings 是 SKILL.md 校验失败/重名等告警
   */
  skillApp.get("/", (ctx) => {
    return ctx.json(conversationService.getAvailableSkills());
  });

  return skillApp;
}