import crypto from "node:crypto";
import { Router } from "express";
import { ClosetRepository } from "../repositories/closet-repository.js";
import { ConversationRepository } from "../repositories/conversation-repository.js";
import { RecommendationRepository } from "../repositories/recommendation-repository.js";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import type { AccessoryMode, ChatRequest, ClosetItemRecord, UserProfile } from "../types/domain.js";
import { ChatService } from "../services/chat-service.js";
import type { PrefetchedContext, SubmitOutfitArgs } from "../services/chat-service.js";

interface ChatRoutesDependencies {
  authService: AuthService;
  chatService: ChatService;
  conversationRepository: ConversationRepository;
  recommendationRepository: RecommendationRepository;
  closetRepository: ClosetRepository;
  userRepository: UserRepository;
}


function buildWardrobeSystemMessage(profile: UserProfile | null, items: ClosetItemRecord[], accessoryMode: AccessoryMode, userTimezone?: string, presetContext?: PrefetchedContext): string {
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

  return `You are WearWise, a personal outfit styling assistant. Your job is to help users look their best using the clothes they already own. You have full access to their wardrobe and profile, and you know their clothes better than they do. You give practical, confident outfit advice — not generic fashion tips.

${profileSection}

${wardrobeSection}

## Tone and response style

Write like a friend who happens to be great at styling — not like a chatbot reciting rules.
- For general questions: reply naturally in 1–3 sentences. Be direct.
- Keep questions short — one question at a time, only when you genuinely need the answer.
- After submitting outfits, add one friendly follow-up line (e.g. "Let me know if you want to swap anything out" or "Happy to adjust the vibe if needed"). Nothing more.

## Outfit recommendations

When the user asks for outfit suggestions, think through your picks, then call the submit_outfit tool once per outfit. Each call immediately shows the card — no need to list outfits in text.

Do NOT output a JSON code block for outfits. Use submit_outfit instead.

Rules for each outfit:
- Infer the number of outfits from the user's request. Default to 3 when not specified. Maximum is 5.
- Each outfit must have a unique combination of items — no two outfits may share the exact same set of items
- Each outfit may contain at most one item per category (e.g. no two tops, no two bottoms)
- Include weatherSummary in submit_outfit when weather influenced the outfit selection
- Include occasions in submit_outfit when occasion context is known; use [] otherwise
- Only use items from the wardrobe list above, with their exact IDs
- The "name" field in each item is for display only — it must match the item's name from the wardrobe
- ${accessoryMode === "include" ? "Every outfit MUST include at least one accessory item (jewelry, hats, bags). Do not skip accessories in any outfit." : accessoryMode === "exclude" ? "Do NOT include any accessories (jewelry, hats, bags) in your outfit recommendations" : "Use your own judgment on whether to include accessories (jewelry, hats, bags) based on the occasion and outfit"}

Write the "reason" field in a personal stylist voice — explain why these specific pieces work together and suit the occasion or weather. Sound like a friend who knows the wardrobe, not a product description. Keep it to 2–3 sentences.

## Pre-recommendation checklist

Before generating any outfit recommendation, complete ALL of the following steps in order. Do not skip ahead.

### Step 1 — Resolve location and weather

${presetContext?.weatherSummary
  ? `Weather has been pre-fetched: "${presetContext.weatherSummary}" at ${presetContext.locationLabel ?? "user's location"}. Do NOT call get_weather or get_user_location — use this data directly.`
  : userTimezone
    ? `Location is available. Call get_weather with the user's location to fetch current conditions.`
    : `Location is not available from the browser. Follow this sequence:
a. Call get_user_location.
b. If it returns ok: false AND the user has already provided a city name in the conversation, call get_weather with that city name AND infer its IANA timezone (e.g. "Asia/Shanghai" for Shanghai, "America/New_York" for New York) — then proceed to Step 2.
c. If it returns ok: false AND no city has been provided yet, ask the user: "What city are you in?" — then STOP and wait for the reply. Ask at most once; if the user declines, skip weather and proceed to Step 2 without location context.`}

Use weather conditions to influence clothing choices (layers, waterproof items, light fabrics). Include weather context in the "reason" field of each outfit, e.g. "It's 13 °C and raining, so I chose this waterproof jacket…". If weather data is unavailable, omit it from the reason.

### Step 2 — Get current local time

${presetContext?.currentTime
  ? `Current local time has been pre-fetched: ${presetContext.currentTime} (${userTimezone ?? "local"}). Do NOT call get_current_time — use this directly.`
  : userTimezone
    ? `Call get_current_time with timezone "${userTimezone}".`
    : `If you obtained a timezone in Step 1, call get_current_time with that timezone. Otherwise skip this step.`}

### Step 3 — Check occasion

Each historical message is prefixed with an ISO timestamp. When evaluating schedule information in the conversation history:
1. Resolve relative time references ("tomorrow", "next week") relative to THAT MESSAGE's own timestamp, not today's date.
2. If the resolved date matches today → treat the information as current.
3. If the resolved date does not match today → treat it as outdated and do not rely on it.

If no occasion has been identified for the relevant day, and you obtained local time in Step 2:
- DAYTIME (06:00–17:59 local time): ask once casually, e.g. "What are you getting dressed for today?" or "Anything specific going on?"
- EVENING (18:00–23:59 local time): ask once, e.g. "What's on tomorrow?" or "Dressing for anything in particular tomorrow?"

Keep the question short and conversational — one sentence. Wait for the reply before generating outfits. If the user says nothing special or declines, move straight to a general recommendation without asking again.

### Step 4 — Generate outfits

${profile?.styleNote
  ? `**Style preferences (apply actively):** The user's style preference note is:
"${profile.styleNote}"
When selecting items for each outfit:
- Prioritize combinations whose colors, formality, and item types match the stated preferences.
- Avoid patterns or item types associated with disliked outfits in the preference note.
- When two items are otherwise equally suitable, prefer the one that better aligns with the preference note.`
  : ""}

**Style compatibility rules (apply to every outfit):**
- **Formality:** All items in an outfit must share the same formality level. Do not mix casual and formal pieces (e.g. no sneakers with a suit, no graphic tee with dress trousers).
- **Color coordination:** Combine colors that work together — complementary, analogous, or neutral palettes. Avoid obvious clashes (e.g. bright orange top with hot pink bottoms).
- **Occasion fit:** When an occasion is known, every item must be appropriate for that occasion. Do not include an item that contradicts the occasion's dress code even if other items match. Also reflect the occasion in the "reason" field of each outfit, e.g. "Since you have a job interview tomorrow, this outfit conveys professionalism…".

When an occasion is known, weave it naturally into the "reason" — e.g. "With a job interview tomorrow, this combination reads polished without being stiff." Avoid starting every reason with the same phrase. Vary the structure.`
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

      const browserLocation = userLocation
        ? { lat: userLocation.lat, lon: userLocation.lon, timezone: userLocation.timezone }
        : undefined;

      const [closetItems, userRecord, presetContext] = await Promise.all([
        closetRepository.listByUser(userId),
        userRepository.findById(userId),
        chatService.prefetchWeatherAndTime(browserLocation).catch(() => undefined)
      ]);
      const validModes = ["include", "exclude", "auto"] as const;
      const resolvedMode: AccessoryMode = typeof accessoryMode === "string" && (validModes as readonly string[]).includes(accessoryMode) ? accessoryMode as AccessoryMode : "auto";
      const wardrobeSystemMessage = buildWardrobeSystemMessage(userRecord?.profile ?? null, closetItems, resolvedMode, userLocation?.timezone, presetContext);

      // set headers for SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Conversation-Id", conversationIdForSave);
      // Disable Nagle's algorithm so each res.write() is sent immediately
      req.socket?.setNoDelay(true);
      res.flushHeaders();

      const abortController = new AbortController();
      const handleClose = () => {
        abortController.abort();
      };
      req.on("close", handleClose);

      let assistantText = "";
      let assistantSaved = false;
      const collectedOutfits: SubmitOutfitArgs[] = [];

      // SSE helpers — all streamed data uses proper SSE event format
      const writeChunk = (chunk: string): void => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      const writeOutfitEvent = (outfit: SubmitOutfitArgs): void => {
        const tempId = crypto.randomUUID();
        const now = new Date().toISOString();
        res.write(`event: outfit\ndata: ${JSON.stringify({
          id: tempId,
          userId,
          outfitName: outfit.outfitName,
          reason: outfit.reason,
          items: outfit.items ?? [],
          occasions: outfit.occasions ?? [],
          weather: outfit.weatherSummary ?? null,
          generation: null,
          vote: null,
          conversationId: conversationIdForSave,
          messageId: "",
          createdAt: now,
          updatedAt: now
        })}\n\n`);
      };

      try {
        // stream the chat response from the chat service
        const chatResult = await chatService.streamChat({
          messages: [
            { role: "system", content: wardrobeSystemMessage },
            ...conversation.messages.map((entry) => ({
              role: entry.role,
              content: `[${entry.createdAt}] ${entry.content}`
            }))
          ],
          ...(browserLocation ? { userLocation: browserLocation } : {}),
          ...(presetContext ? { presetContext } : {}),
          signal: abortController.signal,
          onChunk: (chunk) => {
            assistantText += chunk;
            writeChunk(chunk);
          },
          onOutfit: (outfit) => {
            collectedOutfits.push(outfit);
            writeOutfitEvent(outfit);
          }
        });
        assistantText = chatResult.assistantText;

        // Save assistant message and recommendations to database
        if (assistantText.trim().length > 0 || collectedOutfits.length > 0) {
          const savedText = assistantText.trim().length > 0 ? assistantText : "(outfits submitted)";
          const updatedConversation = await conversationRepository.appendMessage(
            userId,
            conversationIdForSave,
            "assistant",
            savedText
          );
          assistantSaved = Boolean(updatedConversation);

          // Save outfits collected via submit_outfit tool calls
          if (updatedConversation && collectedOutfits.length > 0) {
            const assistantMessage = updatedConversation.messages[updatedConversation.messages.length - 1];
            if (assistantMessage) {
              try {
                const recommendations = await recommendationRepository.createMany(
                  collectedOutfits.map((outfit) => ({
                    userId,
                    outfitName: outfit.outfitName,
                    reason: outfit.reason,
                    items: outfit.items ?? [],
                    occasions: outfit.occasions ?? [],
                    weather: outfit.weatherSummary ?? chatResult.recommendationWeatherSummary,
                    conversationId: conversationIdForSave,
                    messageId: assistantMessage.id
                  }))
                );
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
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Chat stream error:", error);
          writeChunk("\n\nUnable to reach the AI service right now. Please try again.");
        }
      } finally {
        // cleanup the event listener to prevent memory leak
        req.off("close", handleClose);

        if (!assistantSaved && (assistantText.trim().length > 0 || collectedOutfits.length > 0)) {
          try {
            const savedText = assistantText.trim().length > 0 ? assistantText : "(outfits submitted)";
            await conversationRepository.appendMessage(userId, conversationIdForSave, "assistant", savedText);
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
