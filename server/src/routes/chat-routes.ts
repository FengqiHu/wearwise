import { Router } from "express";
import { ClosetRepository } from "../repositories/closet-repository.js";
import { ConversationRepository } from "../repositories/conversation-repository.js";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import type { ChatRequest, ClosetItemRecord, UserProfile } from "../types/domain.js";
import { ChatService } from "../services/chat-service.js";

interface ChatRoutesDependencies {
  authService: AuthService;
  chatService: ChatService;
  conversationRepository: ConversationRepository;
  closetRepository: ClosetRepository;
  userRepository: UserRepository;
}

function buildWardrobeSystemMessage(profile: UserProfile | null, items: ClosetItemRecord[]): string {
  const profileSection = profile
    ? `User profile:
- Name: ${profile.name}
- Height: ${profile.heightCm} cm
- Weight: ${profile.weightKg} kg
- Style preferences: ${profile.styleNote || "not specified"}`
    : "User profile: not set up yet.";

  const readyItems = items.filter((item) => item.analysisStatus === "ready");

  const wardrobeSection =
    readyItems.length === 0
      ? "Wardrobe: no clothing items available yet."
      : `Wardrobe (${readyItems.length} items):
${readyItems
  .map(
    (item) =>
      `- ID: ${item.id} | Name: ${item.name ?? "Unnamed"} | Category: ${item.category ?? "Unknown"} | Tags: ${item.tags.join(", ") || "none"} | Description: ${item.description ?? "none"}`
  )
  .join("\n")}`;

  return `You are a personal stylist assistant with access to the user's wardrobe and profile.

${profileSection}

${wardrobeSection}

When recommending outfits, only use items from the wardrobe list above, referenced by their exact IDs.`;
}

export function createChatRoutes({ authService, chatService, conversationRepository, closetRepository, userRepository }: ChatRoutesDependencies): Router {
  const router = Router();

  router.get("/chat/conversations", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const conversations = await conversationRepository.listByUser(authResolution.user.id);
      res.json({ conversations });
    } catch (error) {
      console.error("Chat list error:", error);
      res.status(500).json({ error: "Failed to load chat history." });
    }
  });

  router.get("/chat/conversations/:conversationId", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const conversationId = (req.params.conversationId ?? "").trim();

      if (!conversationId) {
        res.status(400).json({ error: "conversationId is required." });
        return;
      }

      const conversation = await conversationRepository.findById(authResolution.user.id, conversationId);

      if (!conversation) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }

      res.json({
        conversation: {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          lastMessageAt: conversation.lastMessageAt
        },
        messages: conversation.messages
      });
    } catch (error) {
      console.error("Chat detail error:", error);
      res.status(500).json({ error: "Failed to load conversation." });
    }
  });

  router.delete("/chat/conversations/:conversationId", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const conversationId = (req.params.conversationId ?? "").trim();

      if (!conversationId) {
        res.status(400).json({ error: "conversationId is required." });
        return;
      }

      const deleted = await conversationRepository.deleteById(authResolution.user.id, conversationId);

      if (!deleted) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error("Chat delete error:", error);
      res.status(500).json({ error: "Failed to delete conversation." });
    }
  });

  router.post("/chat", async (req, res): Promise<void> => {
    let shouldCloseResponse = true;

    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      if (!chatService.isConfigured()) {
        res.status(500).json({ error: "OPENAI_API_KEY is not configured on server." });
        return;
      }

      const { message, conversationId } = req.body as ChatRequest;
      const trimmedMessage = typeof message === "string" ? message.trim() : "";
      const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

      if (!trimmedMessage) {
        res.status(400).json({ error: "message is required." });
        return;
      }

      const userId = authResolution.user.id;
      let conversation = trimmedConversationId
        ? await conversationRepository.appendMessage(userId, trimmedConversationId, "user", trimmedMessage)
        : await conversationRepository.createWithFirstUserMessage(userId, trimmedMessage);

      if (!conversation) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }

      const conversationIdForSave = conversation.id;

      const [closetItems, userRecord] = await Promise.all([
        closetRepository.listByUser(userId),
        userRepository.findById(userId)
      ]);
      const systemMessage = buildWardrobeSystemMessage(userRecord?.profile ?? null, closetItems);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Conversation-Id", conversationIdForSave);

      const abortController = new AbortController();
      const handleClose = () => {
        abortController.abort();
      };
      req.on("close", handleClose);

      let assistantText = "";
      let assistantSaved = false;

      try {
        await chatService.streamChat({
          messages: [
            { role: "system", content: systemMessage },
            ...conversation.messages.map((entry) => ({
              role: entry.role,
              content: entry.content
            }))
          ],
          signal: abortController.signal,
          onChunk: (chunk) => {
            assistantText += chunk;
            res.write(chunk);
          }
        });

        if (assistantText.trim().length > 0) {
          const updatedConversation = await conversationRepository.appendMessage(
            userId,
            conversationIdForSave,
            "assistant",
            assistantText
          );
          assistantSaved = Boolean(updatedConversation);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Chat stream error:", error);
          res.write("\n\nUnable to reach the AI service right now. Please try again.");
        }
      } finally {
        req.off("close", handleClose);

        if (!assistantSaved && assistantText.trim().length > 0) {
          try {
            await conversationRepository.appendMessage(userId, conversationIdForSave, "assistant", assistantText);
          } catch (appendError) {
            console.error("Failed to persist assistant response:", appendError);
          }
        }

        if (!res.writableEnded) {
          res.end();
        }
      }

      shouldCloseResponse = false;
    } catch (error) {
      console.error("Chat error:", error);

      if (!res.headersSent) {
        res.status(500).json({ error: "Something went wrong." });
        return;
      }

      if (!res.writableEnded && shouldCloseResponse) {
        res.end();
      }
    }
  });

  return router;
}
