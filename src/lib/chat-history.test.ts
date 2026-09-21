import { describe, expect, it } from "vitest";

import { getRecentChatHistory, maxChatHistoryCharacters, maxChatHistoryMessages } from "./chat-history";

describe("recent chat history", () => {
  it("keeps only the most recent bounded messages in chronological order", () => {
    const messages = Array.from({ length: maxChatHistoryMessages + 2 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `Mensagem ${index + 1}`,
    }));

    expect(getRecentChatHistory(messages)).toEqual(messages.slice(-maxChatHistoryMessages));
  });

  it("uses only prior turns, leaving the current message outside history", () => {
    const history = getRecentChatHistory([
      { role: "user", content: "Analise a Clima Prime." },
      { role: "assistant", content: "A Clima Prime está qualificada." },
    ]);

    expect(history).toEqual([
      { role: "user", content: "Analise a Clima Prime." },
      { role: "assistant", content: "A Clima Prime está qualificada." },
    ]);
    expect(history.some((message) => message.content === "Qual foi o principal ponto que você encontrou nela?")).toBe(false);
  });

  it("keeps the most recent complete turns within the total character budget", () => {
    const message = "a".repeat(4_000);
    const history = getRecentChatHistory([
      { role: "user", content: message },
      { role: "assistant", content: message },
      { role: "user", content: message },
      { role: "assistant", content: message },
    ]);

    expect(history).toHaveLength(3);
    expect(history.reduce((total, item) => total + item.content.length, 0)).toBe(maxChatHistoryCharacters);
  });
});
