import * as fs from "fs";
import * as path from "path";
import type { UIMessage } from "ai";

/**
 * Simple file-based conversation storage for development
 * Stores conversations as JSON files
 */

const CONVERSATIONS_DIR = path.join(process.cwd(), ".voltagent", "conversations");

// Ensure directory exists
function ensureDirectoryExists() {
  if (!fs.existsSync(CONVERSATIONS_DIR)) {
    fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  }
}

export interface StoredConversation {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: UIMessage[];
}

/**
 * Save conversation to disk
 */
export function saveConversation(
  conversationId: string,
  userId: string,
  messages: UIMessage[]
): void {
  try {
    ensureDirectoryExists();

    const conversation: StoredConversation = {
      id: conversationId,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages,
    };

    const filePath = path.join(CONVERSATIONS_DIR, `${conversationId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2), "utf-8");
  } catch (error) {
    console.error(`Error saving conversation ${conversationId}:`, error);
    // Don't throw - let chat continue even if save fails
  }
}

/**
 * Load conversation from disk
 */
export function loadConversation(conversationId: string): StoredConversation | null {
  try {
    ensureDirectoryExists();

    const filePath = path.join(CONVERSATIONS_DIR, `${conversationId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as StoredConversation;
  } catch (error) {
    console.error(`Error loading conversation ${conversationId}:`, error);
    return null;
  }
}

/**
 * Get all conversations for a user
 */
export function getUserConversations(userId: string): StoredConversation[] {
  try {
    ensureDirectoryExists();

    if (!fs.existsSync(CONVERSATIONS_DIR)) {
      return [];
    }

    const files = fs.readdirSync(CONVERSATIONS_DIR).filter((f) => f.endsWith(".json"));
    const conversations: StoredConversation[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(CONVERSATIONS_DIR, file);
        const data = fs.readFileSync(filePath, "utf-8");
        const conv = JSON.parse(data) as StoredConversation;

        if (conv.userId === userId) {
          conversations.push(conv);
        }
      } catch (err) {
        console.error(`Error reading file ${file}:`, err);
        continue;
      }
    }

    // Sort by recent first
    return conversations.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (error) {
    console.error(`Error getting conversations for user ${userId}:`, error);
    return [];
  }
}

/**
 * Delete conversation
 */
export function deleteConversation(conversationId: string): void {
  try {
    const filePath = path.join(CONVERSATIONS_DIR, `${conversationId}.json`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`Error deleting conversation ${conversationId}:`, error);
  }
}
