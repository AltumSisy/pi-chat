import type { GlobalConfig } from "@server/config";
import type { ConversationRecord } from "./types.ts";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

export class ConversationReposity {
  private readonly globalConfig: GlobalConfig;

  constructor(globalConfig: GlobalConfig) {
    this.globalConfig = globalConfig;
  }

  recordPath(conversationId: string) {
    return join(this.globalConfig.recordsDir, conversationId);
  }

  async save(convsersationRecord: ConversationRecord) {
    const conversationRecordPath = this.recordPath(convsersationRecord.id);
    await mkdir(conversationRecordPath, { recursive: true });
    await writeFile(
      conversationRecordPath,
      JSON.stringify(convsersationRecord),
    );
  }

  async get(conversationId: string): Promise<ConversationRecord | null> {
    const conversationRecordPath = this.recordPath(conversationId);
    try {
      const data = await readFile(conversationRecordPath, "utf-8");
      return JSON.parse(data) as ConversationRecord;
    } catch (error) {
      return null;
    }
  }

  async update(
    conversationId: string,
    updateConversationRecord: Partial<ConversationRecord>,
  ) {
    const conversationRecord = await this.get(conversationId);
    if (!conversationRecord) throw new Error(`not conversationRecord`);
    const mergeConversationRecord: ConversationRecord = {
      ...conversationRecord,
      ...updateConversationRecord,
      updatedAt: new Date().toDateString(),
    };

    await this.save(mergeConversationRecord);
  }

  async delete(conversationId: string) {
    const conversationRecordPath = this.recordPath(conversationId);
    rm(conversationRecordPath, { force: true });
  }
}
