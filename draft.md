
curl -X POST http://localhost:4328/api/conversation

```json
{
  "conversationSummary": {
    "id": "6fd181c5-8982-4702-a8d1-764bc1b86878",
    "title": "New Conversation",
    "createAt": "Wed Sep 30 2026",
    "updateAt": "Wed Sep 30 2026",
    "workspaceDir": "D:\\code\\pi-chat-work\\workspaces\\6fd181c5-8982-4702-a8d1-764bc1b86878",
    "status": "ready"
  },
  "messageList": [],
  "model": {
    "provider": "dashscope",
    "id": "deepseek-v4-pro"
  },
  "thinkingLevel": "high",
  "availableThinkingLevels": [
    "off",
    "low",
    "high",
    "max"
  ],
  "status": "ready",
  "stream": {
    "id": "6bfae1e3-bbe9-4f18-9af3-67dc2a756ca9",
    "seqId": 0
  },
  "diagnostics": []
}
```

//发送消息
curl.exe -N -X POST http://localhost:4328/api/conversation/6fd181c5-8982-4702-a8d1-764bc1b86878/message -H 'Content-Typ: application/x-www-form-urlencoded' \ --data-urlencode 'text=hi'
//消费
curl.exe -N -X  GET "http://localhost:4328/api/conversation/6fd181c5-8982-4702-a8d1-764bc1b86878/stream"

//获取历史消息：
 curl.exe -X POST http://127.0.0.1:4328/api/conversation/6fd181c5-8982-4702-a8d1-764bc1b86878


后端debug: pnpm server:debug
前端：pnpm web:dev



会话列表
会话切换 
会话删除
会话编辑
会话终止


会话配置
model list
thinking level list

会话配置切换