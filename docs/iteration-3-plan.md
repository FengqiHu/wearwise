# **Iteration 3 Plan**

**Dates:** Week 11–12 (due 2026-04-13)

**Goal:** Personalization and feedback loop — outfit voting, history, accessory control, and richer recommendation context.

## **Requirements & Acceptance Criteria & Task Breakdown**

### **R1. Outfit Voting**

**Description:** Users can upvote or downvote recommended outfits. Votes are stored per user and will inform personalized recommendations in future sessions.

**Task Breakdown:**

- Add `votes` field to the user profile schema (array of `{ outfitHash, vote: 'up' | 'down' }`)
- Create `POST /api/outfits/vote` endpoint to record a vote
- Add thumbs-up / thumbs-down buttons to outfit cards in the chat UI and wardrobe recommendation panel
- Write tests for the vote endpoint: valid vote stored, duplicate vote updates existing record, invalid payload rejected

**Acceptance Criteria:**

- Each recommended outfit card shows a thumbs-up and thumbs-down button
- Clicking a vote button sends the outfit composition and vote direction to the backend
- Voting on an already-voted outfit updates (not duplicates) the stored vote
- Votes are associated with the authenticated user and persisted in MongoDB

---

### **R2. LLM-Enhanced Recommendation Context**

**Description:** Enrich the system prompt sent to LLM with the user's sex, and instruct the LLM to infer the occasion from conversation history and summarize weather conditions in recommendations. Additionally, inject message timestamps into the conversation context so the LLM can reason about the recency of historical messages and avoid acting on stale information. Currently, `buildWardrobeSystemMessage()` only injects name, height, weight, and style note; and `createdAt` is stripped from messages before being passed to the LLM, making it impossible to distinguish old context from new.

**Task Breakdown:**

- Add optional field `sex?: 'male' | 'female' | 'other'` to `UserProfile` in `server/src/types/domain.ts`
- Update `parseProfileFromRequest()` in `server/src/services/profile-service.ts` to read and validate the `sex` field
- Add a sex selector (male / female / other) to the Profile page UI, saving via the existing `POST /api/profile`
- Extend `buildWardrobeSystemMessage()` to include the user's sex in the profile section; fall back to `"not specified"` when unset
- Extend `buildWardrobeSystemMessage()` with an occasion inference instruction: require the LLM to extract the user's destination or activity from conversation history, and proactively ask before recommending if the occasion is unclear
- Extend `buildWardrobeSystemMessage()` with a weather summary instruction: require the LLM to open each recommendation with a one-line weather summary (e.g., `"Cool and rainy, 12 °C"`) when weather data is available
- In `chat-routes.ts`, update `conversation.messages.map()` to prepend `entry.createdAt` to each message's content (e.g., `[2026-03-31T09:00:00Z] I need an outfit for my interview`)
- Write integration tests for `POST /api/chat` verifying the system prompt contains the sex field, timestamp prefixes, and weather summary instruction; write unit tests for profile sex field persistence; mock the chat service — no real Gemini calls; document manual testing of LLM weather summary output in the PR description

**Acceptance Criteria:**

- Users can set their sex on the Profile page; the value persists and is returned by `GET /api/profile`; when unset, the system prompt falls back to `"not specified"` rather than omitting the field
- The system prompt includes the user's sex (e.g., `"Sex: male"`)
- When the user has not mentioned an occasion, the AI asks about their plans before making recommendations; when the occasion can be inferred from the conversation, the AI states it explicitly at the start of the response (e.g., `"Based on your job interview tomorrow..."`)
- Each historical message carries a timestamp prefix, allowing the LLM to distinguish stale context from the current request and avoid carrying over outdated occasion information
- When weather data is available, recommendations open with a one-line weather summary and clothing choices reflect the conditions

---

### **R3. Accessory Toggle**

**Description:** Users can choose whether the recommendation system should include accessories (jewelry, hats, bags) in its outfit suggestions. This is a per-request setting, not a global preference.

**Task Breakdown:**

- Add an "Include accessories" toggle to the chat input UI
- Pass the toggle value as a field in the `POST /api/chat` request body
- Update the recommendation system prompt to conditionally include or exclude accessory-category items based on the flag
- Write tests verifying accessories are included or excluded from the context based on the flag

**Acceptance Criteria:**

- The chat interface shows an "Include accessories" toggle (default: off)
- When the toggle is on, accessory-category items from the closet are included in the Gemini context
- When the toggle is off, accessory-category items are excluded from the context
- The toggle state is reflected in the recommendation output

---

### **R4. Try-On History Page**

**Description:** The system stores try-on images. Users can access a history page to review past recommendations and generated images.

**Task Breakdown:**

- Build a History page in the frontend with a session list and a detail view
- Write tests for session persistence and retrieval endpoints

**Acceptance Criteria:**

- After a chat session with recommendations is complete, it is saved to the database automatically
- The History page shows a chronological list of past sessions with date, occasion, and a thumbnail of the first try-on image
- Clicking a session shows the full conversation and all generated try-on images
- Sessions are user-scoped — users cannot access other users' history
- The history page is accessible from the main navigation

---

## **Coordination & Design Decisions**

- **Voting storage:** Outfit identity is determined by the sorted set of clothing item IDs. This hash is computed on the backend to ensure consistency across sessions. Frontend sends the raw item ID array; backend computes the hash before storing.
- **History persistence:** Sessions are written asynchronously after the chat response is sent, so history storage does not block the user-facing response. Failures in history persistence are logged but do not surface to the user.
- **Accessory toggle:** Accessories are defined as items with `category: "accessory"` in the closet schema. No new category type is introduced — this relies on correct categorization during upload/analysis.
**Ownership**

- `@FengqiHu`: Outfit voting — backend and frontend (R1)
- `@ZeliMa`: LLM recommendation context enrichment (R2) 
- `@z8ri`: Accessory toggle (R3)
- `@Nanshengbeisheng`: History page (R4) 

**Dependency Order**

- Session persistence (R4 backend) must land before the history page UI (R4 frontend) is testable end-to-end.
- Voting endpoint (R1 backend) must exist before outfit card vote buttons (R1 frontend) can be wired up.
- LLM context enrichment (R2) should land early so other recommendation-adjacent work can be tested against the richer prompt.
