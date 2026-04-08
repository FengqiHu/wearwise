import { Router } from "express";
import { ClosetRepository } from "../repositories/closet-repository.js";
import { ConversationRepository } from "../repositories/conversation-repository.js";
import { RecommendationRepository } from "../repositories/recommendation-repository.js";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import type { AccessoryMode, ChatRequest, ClosetItemRecord, UserProfile } from "../types/domain.js";
import { ChatService } from "../services/chat-service.js";

interface ChatRoutesDependencies {
  authService: AuthService;
  chatService: ChatService;
  conversationRepository: ConversationRepository;
  recommendationRepository: RecommendationRepository;
  closetRepository: ClosetRepository;
  userRepository: UserRepository;
}

interface ParsedOutfit {
  outfitName: string;
  reason: string;
  items: Array<{ id: string; name: string }>;
}

interface ParsedOutfitResponse {
  outfits: ParsedOutfit[];
}

function parseOutfitResponse(content: string): ParsedOutfitResponse | null {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "outfits" in parsed &&
      Array.isArray((parsed as ParsedOutfitResponse).outfits)
    ) {
      return parsed as ParsedOutfitResponse;
    }
    return null;
  } catch {
    return null;
  }
}

function buildWardrobeSystemMessage(profile: UserProfile | null, items: ClosetItemRecord[], accessoryMode: AccessoryMode, userTimezone?: string): string {
  const profileSection = profile
    ? `User profile:
- Name: ${profile.name}
- Height: ${profile.heightCm} cm
- Weight: ${profile.weightKg} kg
- Style preferences: ${profile.styleNote || "not specified"}`
    : "User profile: not set up yet.";

  const readyItems = items.filter(
    (item) => item.analysisStatus === "ready" && (accessoryMode !== "exclude" || item.category !== "accessories")
  );

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

## Response rules

For general questions (greetings, advice, non-outfit topics): reply in plain conversational text.

For outfit recommendation requests: you MUST respond with ONLY a JSON code block in this exact format, no other text before or after:

\`\`\`json
{
  "outfits": [
    {
      "outfitName": "Outfit name here",
      "reason": "Why this outfit suits the occasion and user",
      "items": [
        { "id": "<exact item ID>", "name": "<item name>" }
      ]
    }
  ]
}
\`\`\`

Rules for the JSON:
- Always include exactly 3 outfits in the "outfits" array
- Each outfit must have a unique combination of items — no two outfits may share the exact same set of items
- Each outfit may contain at most one item per category (e.g. no two tops, no two bottoms)
- Only use items from the wardrobe list above, with their exact IDs
- The "name" field in each item is for display only — it must match the item's name from the wardrobe
- ${accessoryMode === "include" ? "Every outfit MUST include at least one accessory item (jewelry, hats, bags). Do not skip accessories in any outfit." : accessoryMode === "exclude" ? "Do NOT include any accessories (jewelry, hats, bags) in your outfit recommendations" : "Use your own judgment on whether to include accessories (jewelry, hats, bags) based on the occasion and outfit"}

## Occasion awareness

Before making an outfit recommendation, call get_current_time${userTimezone ? ` with timezone "${userTimezone}"` : ""} to get the current local date and time.

Each historical message is prefixed with an ISO timestamp. When evaluating schedule or occasion information in the conversation history:

1. Resolve any relative time references ("tomorrow", "next week", "明天", "下周", or any absolute date) relative to THAT MESSAGE's own timestamp, not today's date.
2. If the resolved date matches today → treat the information as current, even if the message was sent on a previous day.
3. If the resolved date does not match today → treat the information as outdated and do not rely on it.
4. If no occasion or schedule has been identified for today:
   - DAYTIME (06:00–17:59 local time): ask once naturally, e.g. "Do you have any plans today?"
   - EVENING (18:00–23:59 local time): ask whether the user wants an outfit for today or for tomorrow.
5. If the user declines or has no specific plans → proceed with a general recommendation and do not ask again.`;
}

export function createChatRoutes({ authService, chatService, conversationRepository, recommendationRepository, closetRepository, userRepository }: ChatRoutesDependencies): Router {
  const router = Router();

  // get all conversations
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

  // get chat histroy of a conversation
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

      // Attach recommendations to messages that have recommendationIds
      const messagesWithRecommendations = await Promise.all(
        conversation.messages.map(async (message) => {
          if (!message.recommendationIds || message.recommendationIds.length === 0) {
            return message;
          }
          const recommendations = await Promise.all(
            message.recommendationIds.map((id) => recommendationRepository.findById(authResolution.user!.id, id))
          );
          return {
            ...message,
            recommendations: recommendations.filter(Boolean)
          };
        })
      );

      res.json({
        conversation: {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          lastMessageAt: conversation.lastMessageAt
        },
        messages: messagesWithRecommendations
      });
    } catch (error) {
      console.error("Chat detail error:", error);
      res.status(500).json({ error: "Failed to load conversation." });
    }
  });

  // delete a conversation
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

  // handle chat message, stream the response from the chat service, and save the conversation history in database
  router.post("/chat", async (req, res): Promise<void> => {
    let shouldCloseResponse = true;

    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      // check user status
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      // check chat service configuration
      if (!chatService.isConfigured()) {
        res.status(500).json({ error: "OPENAI_API_KEY is not configured on server." });
        return;
      }

      const { message, conversationId, accessoryMode, userLocation } = req.body as ChatRequest;
      const trimmedMessage = typeof message === "string" ? message.trim() : "";
      const trimmedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";

      if (!trimmedMessage) {
        res.status(400).json({ error: "message is required." });
        return;
      }

      const userId = authResolution.user.id;
      // check if it is a new conversation or an existing conversation
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
      const validModes = ["include", "exclude", "auto"] as const;
      const resolvedMode: AccessoryMode = typeof accessoryMode === "string" && (validModes as readonly string[]).includes(accessoryMode) ? accessoryMode as AccessoryMode : "auto";
      const wardrobeSystemMessage = buildWardrobeSystemMessage(userRecord?.profile ?? null, closetItems, resolvedMode, userLocation?.timezone);

      // set headers for SSE
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
        // stream the chat response from the chat service
        // stream chat includes developer prompt, user prompt, and assistant response with tool calls if have
        await chatService.streamChat({
          messages: [
            { role: "system", content: wardrobeSystemMessage },
            ...conversation.messages.map((entry) => ({
              role: entry.role,
              content: `[${entry.createdAt}] ${entry.content}`
            }))
          ],
          ...(userLocation
            ? { userLocation: { lat: userLocation.lat, lon: userLocation.lon, timezone: userLocation.timezone } }
            : {}),
          signal: abortController.signal,
          // stream callback
          onChunk: (chunk) => {
            assistantText += chunk;
            res.write(chunk);
          }
        });

        // save the msg to database and create recommendations if outfits were generated
        if (assistantText.trim().length > 0) {
          const updatedConversation = await conversationRepository.appendMessage(
            userId,
            conversationIdForSave,
            "assistant",
            assistantText
          );
          assistantSaved = Boolean(updatedConversation);

          // Parse outfits from assistant response and save as recommendation records
          if (updatedConversation) {
            const outfitData = parseOutfitResponse(assistantText);
            if (outfitData && outfitData.outfits.length > 0) {
              const assistantMessage = updatedConversation.messages[updatedConversation.messages.length - 1];
              if (assistantMessage) {
                try {
                  const recommendations = await recommendationRepository.createMany(
                    outfitData.outfits.map((outfit) => ({
                      userId,
                      outfitName: outfit.outfitName,
                      reason: outfit.reason,
                      items: outfit.items.map((item) => ({ id: item.id, name: item.name })),
                      occasions: [],
                      conversationId: conversationIdForSave,
                      messageId: assistantMessage.id
                    }))
                  );

                  // Attach recommendation IDs to the assistant message
                  const recommendationIds = recommendations.map((r) => r.id);
                  await conversationRepository.setMessageRecommendationIds(
                    userId,
                    conversationIdForSave,
                    assistantMessage.id,
                    recommendationIds
                  );
                } catch (error) {
                  console.error("Failed to save recommendations:", error);
                }
              }
            }
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Chat stream error:", error);
          res.write("\n\nUnable to reach the AI service right now. Please try again.");
        }
      } finally {
        // cleanup the event listener to prevent memory leak
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
