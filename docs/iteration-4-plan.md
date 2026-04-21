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

### **R2. Preference-Driven Personalization** (#271)

**Description:** The system already regenerates a `styleNote` asynchronously after each outfit vote using time-decayed weighting, but the summary is based only on outfit names — it lacks item attributes such as category and tags. As a result, the LLM's style inference cannot identify patterns like "I prefer casual cotton tops" or "I dislike formal shoes." Additionally, `buildWardrobeSystemMessage()` treats `styleNote` as a passive data point with no instruction to actively use it, there are no explicit style compatibility rules, outfit count is hardcoded to 3, try-on image prompts lack occasion and weather context, and all outfits arrive in a single block making users wait for the full set before seeing any result.

**Task Breakdown:**

- Enrich `styleNote` generation: extend `VotedOutfit` to include `category` and `tags` per item; join each voted item against the closet in `recommendation-routes.ts` before calling `summarizeStyle()`; update `buildStyleSummaryPrompt()` to include attributes in outfit lines so the LLM can identify attribute-level patterns; silently omit deleted items (#264)
- Add explicit system prompt instruction to use `styleNote`: in `buildWardrobeSystemMessage()` Step 4, tell the LLM to actively prioritize combinations matching the user's style preferences and avoid patterns associated with disliked outfits (#265)
- Add style compatibility rules to `buildWardrobeSystemMessage()` Step 4: formality level matching across all outfit items, color coordination guidance, and occasion-appropriate selection (#266)
- Make outfit count configurable: update system prompt to infer count from conversation (default 3, max 5); update Zod schema from fixed 3 to `.min(1).max(5)` (#267)
- Inject occasion and weather into try-on image prompt: pass `occasions` and `weatherSummary` from the recommendation record to `generateOutfitImage()`; include them in the prompt body, not only the background instruction (#268)
- Stream outfit cards one by one using a `submit_outfit` tool call per outfit: define the tool in `chat-service.ts`, handle each call in `chat-routes.ts` as a separate SSE event, update the frontend stream parser to render each card immediately on arrival (#269)
- Write tests for all R2 changes (#270)

**Acceptance Criteria:**

- After voting, the regenerated `styleNote` reflects item categories and tags, not just outfit names
- System prompt actively instructs the LLM to use `styleNote` when selecting outfit combinations
- Outfit formality is consistent across items; color coordination and occasion-appropriate selection are guided by prompt rules
- Users requesting a specific outfit count receive that number (1–5); default is 3 when unspecified
- Try-on image prompts include occasion and weather context in the outfit description section
- Each outfit card renders as soon as its `submit_outfit` tool call is received, without waiting for remaining outfits
- Deleted closet items in vote history do not cause `styleNote` regeneration to fail

**Bug Fix (related):**

- Fix timezone not sent when browser geolocation is denied: frontend must send `Intl.DateTimeFormat().resolvedOptions().timeZone` independently of `userLocation` so Step 2 (`get_current_time`) and Step 3's daytime/evening occasion check always execute (#263)

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

### **R5. Permanent Account Deletion**

**Description:** Users can permanently delete their WearWise account from within the product. Deletion removes all user-owned application data - profile information, closet metadata, vote history, conversations, try-on history, and stored images - and then signs the user out. The flow must clearly communicate that this deletes the WearWise account only, not the user's Google account, and that the action cannot be undone.

**Task Breakdown:**

- Add an authenticated backend endpoint for account deletion that removes all user-scoped MongoDB records and prevents further access once deletion begins
- Delete all user-owned images from R2 as part of the same flow, including profile photos, closet item images, and generated try-on/history assets
- Add a frontend delete-account action in the profile/settings area with an explicit confirmation step and a post-delete redirect to the signed-out landing page
- Show clear user-facing states for deletion success, deletion failure, and retry guidance
- Write tests for backend cleanup, storage cleanup, and the frontend confirmation flow

**Acceptance Criteria:**

- An authenticated user can permanently delete their WearWise account from the UI after an explicit confirmation step
- After deletion, the user's profile, closet items, vote history, conversations, try-on history, and stored images are no longer accessible through the app
- The user is signed out immediately after deletion and any subsequent request with the deleted identity is rejected
- The UI clearly states that the action deletes the WearWise account and WearWise-managed data only, not the user's Google account

---

### **R6. Uploaded Image Safety Review**

**Description:** Every user-provided image upload path must pass the same review gate (Google Cloud Vision SafeSearch), rejected uploads must never be stored, and users must receive clear feedback when an image is blocked.

**Task Breakdown:**

- Extract a shared backend moderation helper or middleware that runs Google Cloud Vision SafeSearch before any user-provided image is stored or sent to downstream AI processing
- Apply the review step to every upload entry point: face photo, full-body photo, headshot photo, closet item upload/replace.
- Define the threshold policy and rejection mapping for unsafe SafeSearch categories and return consistent user-facing error messages
- Ensure rejected images are not written to R2 or persisted in MongoDB; only structured rejection metadata may be logged for debugging or audit purposes
- Implement fail-closed behavior when the moderation service errors or times out, returning a retriable message instead of bypassing review
- Write backend integration tests for accepted uploads, rejected uploads, and SafeSearch service failure cases

**Acceptance Criteria:**

- Every user-provided image upload route invokes SafeSearch before storage or downstream AI analysis
- Images that exceed the configured safety thresholds are rejected with a clear error message and are not stored in R2 or MongoDB
- If the review service is unavailable, the upload is blocked with a clear retriable error rather than bypassing moderation
- The moderation policy is applied consistently across profile, closet flows

---

## **Coordination & Design Decisions**

- **Enriched vote data join:** The closet lookup added in R2 must handle items deleted since the vote was cast — missing items are silently omitted from the enriched list so that styleNote regeneration does not fail.
- **styleNote and manual edits:** The Profile page allows users to manually edit their `styleNote`. Auto-regeneration from votes will overwrite any manual text. This trade-off is acceptable for now; a future iteration could introduce a separate auto-generated field.
- **Outfit count:** The LLM infers count from the conversation. The Zod schema accepts 1–5; the frontend renders cards in a loop and requires no structural changes for variable counts.
- **Streaming with tool calls:** Each `submit_outfit` tool call carries one complete outfit. The backend emits a dedicated SSE event per call so the frontend can render incrementally. The `context` block (weather summary) is emitted first as a separate event before any outfit cards.
- **Timezone fix:** Browser timezone via `Intl.DateTimeFormat()` requires no permission and is always available. It is sent as a top-level field in the chat request body, separate from the geolocation-gated `userLocation` object.
- **Product try-on isolation:** The product image uploaded on the try-on page must never be written to the user's closet or R2 storage bucket. It first passes through the shared safety review gate, then is analyzed in-memory and discarded after the response is sent.
- **Conversational accessory tool:** The `set_accessory_mode` tool call persists mode to the `conversation` document (not the user profile), so it resets per conversation rather than becoming a global preference. The manual dropdown continues to write to the conversation document and clears any `pendingConfirmation` state.
- **Dropdown sync:** The frontend reads `accessoryMode` from the conversation document returned in each chat response. The dropdown is a controlled component reflecting backend state; local optimistic updates are discarded if the backend returns a different mode.
- **Account deletion scope:** Deleting an account removes WearWise-managed data only; it does not delete the user's Google account. Cleanup covers the user profile, closet items, votes, conversations, try-on history, and all user-owned R2 assets.
- **Centralized upload review:** SafeSearch enforcement is implemented as a shared server-side gate reused by all upload entry points rather than per-route one-off logic.
- **Moderation policy:** "Illegal/offensive" content is operationalized through configured SafeSearch thresholds and fail-closed behavior. Rejected image binaries are not retained after rejection.

**Ownership**

- `@z8ri`: Conversational accessory mode switching (R3)
- `@ZeliMa`: Preference-driven personalization (R2)
- `@FengqiHu`: Online product try-on — shared ownership (R1); UI design rebuild (R4)
- `@Nanshengbeisheng`: Permanent account deletion (R5); Uploaded image safety review (R6)

**Dependency Order**

- R2: `#263` (timezone bug) and `#264`–`#266` (prompt and data changes) are independent and can begin immediately. `#267` (outfit count) should land before `#269` (streaming) so the tool call schema handles variable counts from the start. `#268` (try-on prompt) is independent. `#270` (tests) is end-of-cycle.
- R3: `#254` (pendingConfirmation model + tool) must land before `#255`, `#256`, and `#258`; `#256` must land before `#257`; `#258` and `#259` are end-of-cycle.
- R1: the backend endpoint (`#249`) must land before the frontend page (`#250`) can be wired up end-to-end.
- R5: the backend delete flow and storage cleanup must land before the frontend delete-account action can be wired end-to-end. Background job cancellation or write blocking should land before final destructive cleanup is treated as complete.
- R6: the shared SafeSearch gate and threshold policy should land before individual upload routes are migrated. Product try-on upload should reuse the same moderation gate as R1 rather than introducing a separate review path. Tests are end-of-cycle after all upload entry points are covered.
- R4 has no blocking dependencies and can proceed in parallel with all other work.
