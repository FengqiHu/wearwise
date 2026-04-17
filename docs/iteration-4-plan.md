# **Iteration 4 Plan**

**Dates:** Week 13–14 (due 2026-04-26)

**Goal:** User experience expansion and personalization depth — smarter recommendations driven by vote history, a dedicated product try-on flow, conversational accessory control, and a visual redesign.

## **Requirements & Acceptance Criteria & Task Breakdown**

### **R1. Online Product Try-On**

**Description:** Users can navigate to a new dedicated page, upload a photo of a product they are considering buying, and receive outfit recommendations showing how the new item pairs with their existing wardrobe. They can then request a virtual try-on for any recommended outfit. The uploaded product image is never permanently added to the user's wardrobe — this is purely a "try before you buy" tool.

**Task Breakdown:**

- Add a new backend endpoint `POST /api/product-tryon/analyze` that accepts a product image, extracts clothing metadata with Gemini, and returns outfit recommendations pairing the new item with the user's existing wardrobe items
- Add a new frontend page reachable from the main navigation where users can upload a product image and view recommendations
- Allow users to request a virtual try-on for any recommended outfit on this page and display the generated image
- Handle error states gracefully: no body photo uploaded, upload failure, empty wardrobe
- Write tests for the backend endpoint and the frontend page

**Acceptance Criteria:**

- A new page exists and is reachable via the app navigation
- User can upload a product image and receive outfit recommendations pairing it with their existing wardrobe
- The uploaded product image is not added to the user's wardrobe
- User can request a virtual try-on for a recommended outfit and view the generated image
- Error states (no body photo, upload failure, empty wardrobe) are handled gracefully with clear user-facing messages

---

### **R2. Preference-Driven Personalization**

**Description:** The system already regenerates a `styleNote` asynchronously after each outfit vote using time-decayed weighting, but the summary is based only on outfit names — it lacks item attributes such as category and tags. As a result, the LLM's style inference cannot identify patterns like "I prefer casual cotton tops" or "I dislike formal shoes." Additionally, `buildWardrobeSystemMessage()` in `chat-routes.ts` treats the `styleNote` as a passive data point (`- Style preferences: ...`) with no instruction to the LLM to actively use it when selecting outfit combinations.

**Task Breakdown:**

- Extend the `VotedOutfit` interface in `gemini-recommendation-service.ts` to include per-item `category` and `tags`
- In `recommendation-routes.ts`, when building the voted outfit list for `summarizeStyle()`, join each item's `id` against the user's closet to attach its `category` and `tags`; handle deleted items gracefully by omitting them from the enriched list
- Update `buildStyleSummaryPrompt()` to include item category and tags in the formatted outfit lines so the LLM can identify attribute-level patterns
- In `buildWardrobeSystemMessage()` in `chat-routes.ts`, add an explicit instruction block: when `styleNote` is set, tell the LLM to actively prioritize outfit combinations that match those preferences and avoid patterns the user has expressed dislike for
- Write unit tests for the enriched `buildStyleSummaryPrompt()` covering liked-only, disliked-only, and mixed cases with item attributes; write an integration test for `PATCH /api/recommendations/:id/vote` verifying the enriched item data is passed to `summarizeStyle()`; document manual testing of LLM recommendation output in the PR description

**Acceptance Criteria:**

- After a user votes on at least one outfit, the regenerated `styleNote` reflects item categories and tags — not just outfit names
- The system prompt sent to the LLM contains an explicit instruction to use the user's style preferences when selecting outfit combinations, not merely listing them as a data point
- Deleted closet items referenced in vote history do not cause style summary regeneration to fail
- Failures during `styleNote` regeneration are logged but do not surface to the user and do not affect the vote response

---

### **R3. Conversational Accessory Mode Switching**

**Description:** Iteration 3 delivered a manual dropdown to toggle accessory inclusion. Iteration 4 upgrades this into a conversational experience: the AI recognizes natural language intent, confirms ambiguous requests using multiple-choice replies, persists the confirmed mode to the conversation document via a `set_accessory_mode` tool call, and keeps the dropdown in sync with the backend-driven mode. After switching to exclude mode, the next outfit generation proactively asks whether to add accessories back.

**Task Breakdown:**

- Add a `pendingConfirmation` field to the conversation document schema and implement a `set_accessory_mode` tool the LLM can call to persist the chosen mode (#254)
- Implement the add-accessories-back flow: after a switch to `exclude`, the first subsequent outfit generation asks the user if they want accessories included; if the user's wardrobe has no accessories, return an explanatory refusal instead of switching mode (#255)
- Sync `accessoryMode` from the backend conversation document to the chat dropdown after each AI response (#256)
- Handle manual dropdown changes: apply immediately, clear any `pendingConfirmation`, and persist to the backend (#257)
- Write backend integration tests for conversational mode switching: clear phrase triggers tool call, ambiguous phrase triggers options reply, empty wardrobe blocks mode switch (#258)
- Write frontend E2E tests for conversational accessory mode switching (#259)

**Acceptance Criteria:**

- A clear user phrase ("no accessories", "include accessories", "you decide") triggers an AI confirmation turn followed by a `set_accessory_mode` tool call that updates `conversation.accessoryMode`
- An ambiguous phrase ("keep it minimal") triggers a multiple-choice reply with no tool call yet
- A manual dropdown change applies immediately and clears any pending confirmation
- After switching to exclude, the first outfit generation prompts the user to add accessories back; the user-chosen mode is then persisted
- A user asking to include accessories while their wardrobe has zero accessory items receives an explanatory refusal with no mode switch
- The dropdown reflects the backend `accessoryMode` after each AI response

---

### **R4. UI Design Rebuild**

**Description:** The current UI is visually uneven: the landing page does not clearly communicate what WearWise does, the chat page leaves substantial unused space, and several code paths contain duplicated logic that makes changes slower and increases the risk of inconsistent behavior. This requirement delivers a more polished and consistent visual experience alongside targeted refactoring.

**Task Breakdown:**

- Redesign the landing page to clearly explain the WearWise value proposition and guide new users to sign in and get started (#244)
- Improve the chat page layout to make better use of available screen space without hurting responsiveness on mobile (#244)
- Identify and consolidate repeated code paths into shared utilities, middleware, or components where the abstraction is clearly justified (#245)
- Add a `DESIGN.md` documenting the design direction and key component decisions (#247)

**Acceptance Criteria:**

- The landing page clearly explains what WearWise does and how users get started
- The chat page makes better use of available space without hurting responsiveness on mobile
- Repeated code paths are consolidated into shared utilities or components where appropriate
- A `DESIGN.md` file documents the design decisions made this iteration

---

## **Coordination & Design Decisions**

- **Enriched vote data join:** The closet lookup added in R2 must handle items deleted since the vote was cast — missing items are silently omitted from the enriched list so that styleNote regeneration does not fail.
- **styleNote and manual edits:** The Profile page allows users to manually edit their `styleNote`. Auto-regeneration from votes will overwrite any manual text. This trade-off is acceptable for now; a future iteration could introduce a separate auto-generated field.
- **Product try-on isolation:** The product image uploaded on the try-on page must never be written to the user's closet or R2 storage bucket. It is analyzed in-memory and discarded after the response is sent.
- **Conversational accessory tool:** The `set_accessory_mode` tool call persists mode to the `conversation` document (not the user profile), so it resets per conversation rather than becoming a global preference. The manual dropdown continues to write to the conversation document and clears any `pendingConfirmation` state.
- **Dropdown sync:** The frontend reads `accessoryMode` from the conversation document returned in each chat response. The dropdown is a controlled component reflecting backend state; local optimistic updates are discarded if the backend returns a different mode.

**Ownership**

- `@z8ri`: Online product try-on — backend and frontend (R1); Conversational accessory mode switching (R3)
- `@ZeliMa`: Preference-driven personalization (R2)
- `@FengqiHu`: Online product try-on — shared ownership (R1); UI design rebuild (R4)
- `@Nanshengbeisheng`: Conversational accessory mode switching — testing (R3)

**Dependency Order**

- R2 is self-contained and can begin immediately.
- R3: `#254` (pendingConfirmation model + tool) must land before `#255`, `#256`, and `#258`; `#256` must land before `#257`; `#258` and `#259` are end-of-cycle.
- R1: the backend endpoint (`#249`) must land before the frontend page (`#250`) can be wired up end-to-end.
- R4 has no blocking dependencies and can proceed in parallel with all other work.
