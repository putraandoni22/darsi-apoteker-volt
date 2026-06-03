import { useState, useEffect } from "react";

export interface ConversationMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export function useConversationHistory(conversationId: string, userId: string = "anonymous-user") {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConversation = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `/api/conversations/${conversationId}?userId=${encodeURIComponent(userId)}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch conversation");
      }

      const data = await response.json();
      setMessages(data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      console.error("Error fetching conversation:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (conversationId) {
      fetchConversation();
    }
  }, [conversationId, userId]);

  return { messages, isLoading, error, refetch: fetchConversation };
}

export async function fetchMemoryStats() {
  try {
    const response = await fetch("/api/memory/stats");
    if (!response.ok) throw new Error("Failed to fetch memory stats");
    return await response.json();
  } catch (error) {
    console.error("Error fetching memory stats:", error);
    return null;
  }
}
