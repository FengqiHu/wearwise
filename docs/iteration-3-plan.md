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

**Description:** The system prompt sent to Gemini is enriched with a structured summary of weather conditions, the stated occasion, and the user's sex/body info, so recommendations are more contextually grounded and explainable.

**Task Breakdown:**

- Extend the recommendation system prompt to include a structured weather summary (temperature band, precipitation, wind), occasion label, and user sex
- Update `POST /api/chat` to pass these fields from the request body into the system prompt
- Update the frontend chat input to collect occasion and optionally user sex if not already in the profile
- Write tests verifying the system message contains weather summary, occasion, and user sex fields

**Acceptance Criteria:**

- The system prompt includes a natural-language weather summary (e.g., "Cool and rainy, 12 °C")
- The system prompt includes the stated occasion (e.g., "casual outing", "job interview")
- The system prompt includes the user's sex from their profile
- Recommendations visibly reflect these inputs (e.g., recommending a raincoat on a rainy day)

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
- **Profile photo management:** The replace flow atomically updates the R2 key and MongoDB reference in the same request to avoid orphaned storage objects.

**Ownership**

- `@FengqiHu`: Outfit voting — backend and frontend (R1)
- `@hermit-yoshino-xl`: LLM recommendation context enrichment (R2) 
- `@z8ri`: Accessory toggle (R3)
- `@Nanshengbeisheng`: History page (R4) 

**Dependency Order**

- Session persistence (R5 backend) must land before the history page UI (R5 frontend) is testable end-to-end.
- Voting endpoint (R1 backend) must exist before outfit card vote buttons (R1 frontend) can be wired up.
- LLM context enrichment (R2) should land early so other recommendation-adjacent work can be tested against the richer prompt.
