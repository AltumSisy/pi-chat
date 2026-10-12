import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { EventChannel } from "./channel.ts";
import type { RuntimeStatus } from "@shared/types.ts";

export interface ConversationRecord{
    id:string;
    title:string;
    workspaceDir:string;
    sessionId:string;
    sessionFile:string;
    createdAt:string;
    updatedAt:string;
}

export interface ManagerSession{
    id:string;
    runtime:AgentSessionRuntime;
    unsubscribe?:()=>{};
    channel:EventChannel;
    streamMessageId?:string;
    streamThinkingId?:string;
    status:RuntimeStatus;
    error?:string;
    diagnostics:string[];
}