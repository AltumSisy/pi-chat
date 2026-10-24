import type { GlobalConfig } from "@server/config";
import type { ConversationRecord } from "./types.ts";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";


export class ConversationReposity {
  private readonly globalConfig: GlobalConfig;

  constructor(globalConfig: GlobalConfig) {
    this.globalConfig = globalConfig;
  }

  recordPath(conversationId: string) {
    return join(this.globalConfig.recordsDir, conversationId + ".json");
  }

  async save(convsersationRecord: ConversationRecord) {
    const conversationRecordPath = this.recordPath(convsersationRecord.id);
    await mkdir(this.globalConfig.recordsDir, { recursive: true });
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
      updatedAt: new Date().toISOString(),
    };

    await this.save(mergeConversationRecord);
    return mergeConversationRecord;
  }

  async delete(conversationId: string) {
    const conversationRecordPath = this.recordPath(conversationId);
    rm(conversationRecordPath, { force: true });
  }

  async list(): Promise<ConversationRecord[]> {
    const originFiles = await readdir(this.globalConfig.recordsDir);
    const files = originFiles.filter((file) => file.endsWith(".json"));
    const conversationRecords = await Promise.all(
      files.map(async (file) => {
        try {
          const rawData = await readFile(
            join(this.globalConfig.recordsDir, file),
            "utf-8",
          );
          return JSON.parse(rawData) as ConversationRecord;
        } catch {
          return undefined;
        }
      }),
    );
    return conversationRecords.filter(record => record != undefined);
  }
}
