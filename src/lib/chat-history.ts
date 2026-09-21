export const maxChatHistoryMessages = 8;
export const maxChatHistoryMessageLength = 4_000;
export const maxChatHistoryCharacters = 12_000;

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export function getRecentChatHistory(messages: readonly ChatHistoryMessage[]) {
  const history: ChatHistoryMessage[] = [];
  let totalCharacters = 0;

  for (const message of messages.slice(-maxChatHistoryMessages).reverse()) {
    const content = message.content.trim().slice(0, maxChatHistoryMessageLength);
    if (!content || totalCharacters + content.length > maxChatHistoryCharacters) break;
    history.push({ role: message.role, content });
    totalCharacters += content.length;
  }

  return history.reverse();
}
