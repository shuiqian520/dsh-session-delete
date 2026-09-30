// 重试目标解析(纯函数,便于测试):从会话事件日志里按 messageId 找出「该重发什么」。
//
// 语义(与官方能力对齐):本版 DSH 的事件日志是 append-only,没有「就地重生成」API,
// 所以重试 = 把这条消息对应的**用户输入**重新提交一次:
//   - 目标是 user/message  → 用这条消息自己的文本
//   - 目标是 assistant/message → 用它**之前最近一条** user/message 的文本
// 旧的回复保留在历史上方,新的回复追加在下方。

/** 把一条消息的内容块里的文本拼起来(忽略图片/文件块,重试只重发文本)。 */
export function messageText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  const parts = []
  for (const block of message.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * 在事件序列里解析重试文本。
 * @param events - 会话事件(seq 升序),形如 [{type, data}]
 * @param messageId - 被点击消息的 id
 * @returns { role, text, userMessageId? } 或 undefined(找不到)
 */
export function resolveRetryText(events, messageId) {
  if (!Array.isArray(events) || messageId === undefined || messageId === null) return undefined
  const target = String(messageId)
  let lastUser
  for (const event of events) {
    const message = event && event.data ? event.data.message : undefined
    if (!message || message.id === undefined) continue
    if (event.type === 'user/message') {
      const text = messageText(message)
      lastUser = { id: String(message.id), text }
      if (String(message.id) === target) return { role: 'user', text, userMessageId: String(message.id) }
      continue
    }
    if (event.type === 'assistant/message' && String(message.id) === target) {
      if (lastUser === undefined || lastUser.text === '') return undefined
      return { role: 'assistant', text: lastUser.text, userMessageId: lastUser.id }
    }
  }
  return undefined
}

/** 官方 prompt 的投递模式:queue = 追加到当前回合之后(默认);steer = 打断当前回合。 */
export function normalizeMode(mode) {
  return mode === 'steer' ? 'steer' : 'queue'
}
