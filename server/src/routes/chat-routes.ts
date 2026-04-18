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

interface ParsedRecommendationContext {
  weatherSummary: string | null;
}

interface ParsedOutfit {
  outfitName: string;
  reason: string;
  occasions: string[];
  items: Array<{ id: string; name: string }>;
}

interface ParsedOutfitResponse {
  context: ParsedRecommendationContext;
  outfits: ParsedOutfit[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOccasions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const occasions: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    occasions.push(normalized);
  }

  return occasions;
}

function resolveRecommendationWeatherSummary(
  toolWeatherSummary: string | null,
  weatherSummary: string | null
): string | null {
  return weatherSummary ?? toolWeatherSummary;
}

function normalizeParsedOutfitResponse(parsed: unknown): ParsedOutfitResponse | null {
  if (!isRecord(parsed) || !Array.isArray(parsed.outfits)) {
    return null;
  }

  const context = isRecord(parsed.context)
    ? {
        weatherSummary: parseOptionalString(parsed.context.weatherSummary)
      }
    : {
        weatherSummary: null
      };

  const outfits: ParsedOutfit[] = [];

  for (const entry of parsed.outfits) {
    if (!isRecord(entry)) {
      continue;
    }

    const outfitName = parseOptionalString(entry.outfitName);
    const reason = parseOptionalString(entry.reason);

    if (!outfitName || !reason || !Array.isArray(entry.items)) {
      continue;
    }

    const items = entry.items.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const id = parseOptionalString(item.id);
      const name = parseOptionalString(item.name);

      return id && name ? [{ id, name }] : [];
    });

    if (items.length === 0) {
      continue;
    }

    outfits.push({
      outfitName,
      reason,
      occasions: parseOccasions(entry.occasions),
      items
    });
  }

  if (outfits.length === 0) {
    return null;
  }

  return {
    context,
    outfits
  };
}

function parseOutfitResponse(content: string): ParsedOutfitResponse | null {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match?.[1]) return null;
  try {
    return normalizeParsedOutfitResponse(JSON.parse(match[1]) as unknown);
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
- Sex: ${profile.sex ?? "not specified"}
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
  "context": {
    "weatherSummary": "Short weather summary used for these outfits, or null if none"
  },
  "outfits": [
    {
      "outfitName": "Outfit name here",
      "reason": "Why this outfit suits the occasion and user",
      "occasions": ["Short occasion labels used for this outfit, or []"],
      "items": [
        { "id": "<exact item ID>", "name": "<item name>" }
      ]
    }
  ]
}
\`\`\`

Rules for the JSON:
- Infer the number of outfits to include from the conversation (e.g. if the user says "give me one outfit" include 1, "show me 5 options" include 5). Default to 3 when no count is specified. Maximum is 5.
- Each outfit must have a unique combination of items — no two outfits may share the exact same set of items
- Each outfit may contain at most one item per category (e.g. no two tops, no two bottoms)
- Each outfit must include an "occasions" array. Use [] when no occasion context applies.
- "context.weatherSummary" must be a short factual weather summary when weather influenced the recommendation, otherwise use null
- Only use items from the wardrobe list above, with their exact IDs
- The "name" field in each item is for display only — it must match the item's name from the wardrobe
- ${accessoryMode === "include" ? "Every outfit MUST include at least one accessory item (jewelry, hats, bags). Do not skip accessories in any outfit." : accessoryMode === "exclude" ? "Do NOT include any accessories (jewelry, hats, bags) in your outfit recommendations" : "Use your own judgment on whether to include accessories (jewelry, hats, bags) based on the occasion and outfit"}

## Pre-recommendation checklist

Before generating any outfit recommendation, complete ALL of the following steps in order. Do not skip ahead.

### Step 1 — Resolve location and weather

${userTimezone
  ? `Location is available. Call get_weather with the user's location to fetch current conditions.`
  : `Location is not available from the browser. Follow this sequence:
a. Call get_user_location.
b. If it returns ok: false AND the user has already provided a city name in the conversation, call get_weather with that city name AND infer its IANA timezone (e.g. "Asia/Shanghai" for Shanghai, "America/New_York" for New York) — then proceed to Step 2.
c. If it returns ok: false AND no city has been provided yet, ask the user: "What city are you in?" — then STOP and wait for the reply. Ask at most once; if the user declines, skip weather and proceed to Step 2 without location context.`}

Use weather conditions to influence clothing choices (layers, waterproof items, light fabrics). Include weather context in the "reason" field of each outfit, e.g. "It's 13 °C and raining, so I chose this waterproof jacket…". If weather data is unavailable, omit it from the reason.

### Step 2 — Get current local time

${userTimezone
  ? `Call get_current_time with timezone "${userTimezone}".`
  : `If you obtained a timezone in Step 1, call get_current_time with that timezone. Otherwise skip this step.`}

### Step 3 — Check occasion

Each historical message is prefixed with an ISO timestamp. When evaluating schedule information in the conversation history:
1. Resolve relative time references ("tomorrow", "next week") relative to THAT MESSAGE's own timestamp, not today's date.
2. If the resolved date matches today → treat the information as current.
3. If the resolved date does not match today → treat it as outdated and do not rely on it.

If no occasion has been identified for the relevant day, and you obtained local time in Step 2:
- DAYTIME (06:00–17:59 local time): ask once naturally, e.g. "Do you have any plans today?"
- EVENING (18:00–23:59 local time): ask once, e.g. "Do you have anything planned for tomorrow?"

Wait for the user's reply before generating outfits. If the user declines or has no plans, proceed with a general recommendation and do not ask again.

### Step 4 — Generate outfits

${profile?.styleNote
  ? `**Style preferences (apply actively):** The user's style preference note is:
"${profile.styleNote}"
When selecting items for each outfit:
- Prioritize combinations whose colors, formality, and item types match the stated preferences.
- Avoid patterns or item types associated with disliked outfits in the preference note.
- When two items are otherwise equally suitable, prefer the one that better aligns with the preference note.`
  : ""}

When an occasion is known, include it in the "reason" field of each outfit, e.g. "Since you have a job interview tomorrow, this outfit conveys professionalism…".`;
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

      const userId = authResolution.user.id;
      const conversation = await conversationRepository.findById(userId, conversationId);

      if (!conversation) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }

      const deleted = await conversationRepository.deleteById(userId, conversationId);

      if (!deleted) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }

      await recommendationRepository.deleteByConversation(userId, conversationId);

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
      let recommendationWeatherSummary: string | null = null;

      try {
        // stream the chat response from the chat service
        // stream chat includes developer prompt, user prompt, and assistant response with tool calls if have
        const chatResult = await chatService.streamChat({
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
        assistantText = chatResult.assistantText;
        recommendationWeatherSummary = chatResult.recommendationWeatherSummary;

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
                  const savedWeather = resolveRecommendationWeatherSummary(
                    recommendationWeatherSummary,
                    outfitData.context.weatherSummary
                  );
                  const recommendations = await recommendationRepository.createMany(
                    outfitData.outfits.map((outfit) => ({
                      userId,
                      outfitName: outfit.outfitName,
                      reason: outfit.reason,
                      items: outfit.items.map((item) => ({ id: item.id, name: item.name })),
                      occasions: outfit.occasions,
                      weather: savedWeather,
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
