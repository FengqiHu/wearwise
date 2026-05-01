# AI Output Quality Evaluation

This document records manual evaluations of WearWise's AI components against golden test cases. Each case specifies a concrete input scenario, the expected output characteristics, and the actual result observed from the deployed application.

**Evaluation approach:** Manual testing against the production deployment. Each case is run by a team member who records what the AI actually produced and whether it meets the acceptance criteria.

**Coverage:** Five AI components are evaluated:

| Component | Service | Model |
|---|---|---|
| Outfit recommendation agent | `chat-service.ts → streamChat()` | GPT (OpenAI) |
| Style preference summary | `gemini-recommendation-service.ts → summarizeStyle()` | Gemini Flash Lite |
| Shop outfit pairing | `gemini-recommendation-service.ts → recommendShopOutfits()` | Gemini Flash Lite |
| Outfit completion | `gemini-recommendation-service.ts → recommendOutfit()` | Gemini Flash Lite |
| Virtual try-on image | `image-generation-service.ts → generateTryOn()` | Gemini Flash Image |

---

## Component 1 — Outfit Recommendation Agent

### Case ORA-01: Cold weather triggers outerwear inclusion

**Input conditions**
- Wardrobe: White Oxford Shirt (tops), Dark Denim Jeans (pants), Wool Overcoat (outerwear), Brown Derby Shoes (shoes)
- Simulated weather: 4 °C, overcast (Baltimore, MD)
- User message: "What should I wear today?"

**Expected output characteristics**
- [ ] At least one outfit includes the Wool Overcoat
- [ ] Reason field references the cold temperature or weather conditions
- [ ] No summer-only items recommended as the primary layer
- [ ] `submit_outfit` called (outfit card appears in UI, not a JSON block)

**Actual result** *(tested 2026-04-28, evaluator: ZeliMa776)*
All three recommended outfits included the Wool Overcoat. Reason fields mentioned "4 °C" and "overcast conditions." No outfit omitted outerwear. Outfit cards rendered correctly in the UI.

**Verdict: PASS**

---

### Case ORA-02: Rainy day with work occasion

**Input conditions**
- Wardrobe: White Oxford Shirt (tops), Navy Blazer (tops), Black Chinos (pants), Rain Jacket (outerwear), Wool Overcoat (outerwear), Brown Derby Shoes (shoes), White Sneakers (shoes)
- Simulated weather: 12 °C, moderate rain (Baltimore, MD)
- User message: "I have a work meeting this afternoon."

**Expected output characteristics**
- [ ] Rain Jacket preferred over Wool Overcoat in at least one outfit (weather-appropriate)
- [ ] Formal tops (Oxford Shirt or Navy Blazer) included rather than casual alternatives
- [ ] Brown Derby Shoes preferred over White Sneakers for work context
- [ ] Reason field mentions rain or wet conditions and work/meeting occasion

**Actual result** *(tested 2026-04-28, evaluator: ZeliMa776)*
Rain Jacket appeared in 2 of 3 outfits; one outfit used Wool Overcoat with a note that it provides coverage. Oxford Shirt used in all outfits. Brown Derby Shoes used consistently. Reasons mentioned "rainy afternoon" and "work meeting." One reason incorrectly described the Wool Overcoat as "waterproof" — minor inaccuracy.

**Verdict: PASS** (minor inaccuracy in one reason field, not a functional failure)

---

### Case ORA-03: accessoryMode=exclude respected end-to-end

**Input conditions**
- Wardrobe: Grey Merino Sweater (tops), Khaki Trousers (pants), Down Puffer (outerwear), White Sneakers (shoes), Silver Watch (accessories), Leather Belt (accessories)
- accessoryMode: exclude (set via the accessory toggle in the UI)
- User message: "Give me three casual outfits for the weekend."

**Expected output characteristics**
- [ ] No outfit includes Silver Watch or Leather Belt
- [ ] System message sent to model contains "Do NOT include any accessories"
- [ ] Wardrobe context shown to model lists only 4 items (accessories filtered out)
- [ ] All three submit_outfit calls omit the accessories category entirely

**Actual result** *(tested 2026-04-29, evaluator: z8ri)*
All three outfits contained only tops, pants, outerwear, and shoes. Accessories did not appear in any outfit card. Wardrobe section in the captured system message (verified via server log) showed 4 items with accessories absent.

**Verdict: PASS**

---

### Case ORA-04: Empty wardrobe handled gracefully

**Input conditions**
- Wardrobe: empty (no items uploaded)
- User message: "Recommend an outfit for tonight."

**Expected output characteristics**
- [ ] Agent does NOT call `submit_outfit` (no outfit cards appear)
- [ ] Response explains the wardrobe is empty in a friendly, actionable tone
- [ ] Agent suggests uploading clothing items to get started
- [ ] No crash, no empty outfit card, no hallucinated item IDs

**Actual result** *(tested 2026-04-29, evaluator: z8ri)*
Agent replied: "Your wardrobe is empty right now — upload some clothing items first and I can put together outfits for you." No outfit cards appeared. No submit_outfit calls observed in server logs.

**Verdict: PASS**

---

### Case ORA-05: Ambiguous accessory intent triggers clarification, not tool call

**Input conditions**
- Wardrobe includes accessories (Silver Watch, Navy Scarf)
- accessoryMode: auto
- User message: "Keep it simple."

**Expected output characteristics**
- [ ] Agent does NOT immediately call `set_accessory_mode`
- [ ] Agent asks a clarification question in the format: "(a) include accessories, (b) exclude accessories, or (c) let me decide"
- [ ] No outfit recommendation made yet — agent waits for user confirmation
- [ ] Tool call only occurs in the NEXT turn after explicit user confirmation

**Actual result** *(tested 2026-04-29, evaluator: FengqiHu)*
Agent replied: "Just to confirm — would you like me to (a) include accessories, (b) exclude accessories, or (c) let me decide? Reply with a, b, or c." No `set_accessory_mode` call was made. On follow-up with "b", the agent called `set_accessory_mode({ mode: "exclude" })` and then proceeded with outfit recommendations.

**Verdict: PASS**

---

## Component 2 — Style Preference Summary

### Case SPS-01: Consistent formal preference produces accurate summary

**Input conditions**
- Vote history: 5 upvoted outfits, all containing Navy Blazer + Black Chinos + Brown Derby Shoes
- No downvotes

**Expected output characteristics**
- [ ] Summary mentions preference for formal or structured outfits
- [ ] Summary references specific item types (blazer, dress shoes, or chinos) rather than generic adjectives only
- [ ] Summary written in first person ("I prefer…" / "I like…")
- [ ] Length: 3–4 sentences, no bullet points

**Actual result** *(tested 2026-04-28, evaluator: Nanshengbeisheng)*
Summary: "I tend to gravitate toward structured, office-ready looks anchored by blazers and dress trousers. I consistently choose leather shoes over sneakers, and darker neutral tones like navy and black. I prefer clean, polished combinations without bold patterns or heavy layering."
Written in first person, 3 sentences, mentions specific item types. Accurate reflection of vote history.

**Verdict: PASS**

---

### Case SPS-02: Mixed like/dislike history captures contrast correctly

**Input conditions**
- Upvoted outfits: 3 outfits with casual pieces (Grey Merino Sweater, Dark Denim Jeans, White Sneakers)
- Downvoted outfits: 2 outfits with formal pieces (Navy Blazer, Black Chinos, Brown Derby Shoes)

**Expected output characteristics**
- [ ] Summary reflects casual preference and identifies dislike for formal items
- [ ] Does NOT recommend formal styles as preferred
- [ ] Mentions at least one specific disliked element (e.g. blazers, dress shoes)

**Actual result** *(tested 2026-04-28, evaluator: Nanshengbeisheng)*
Summary correctly identified casual preference and noted "I tend to avoid overly structured or formal combinations, particularly blazers paired with dress trousers." Specific disliked elements were named. No false positive for formal preference.

**Verdict: PASS**

---

## Component 3 — Shop Outfit Pairing

### Case SOP-01: New blazer paired with complementary wardrobe items

**Input conditions**
- New shop item: Navy Blazer (tops)
- Wardrobe: White Oxford Shirt (tops), Black Chinos (pants), Khaki Trousers (pants), Brown Derby Shoes (shoes), White Sneakers (shoes)

**Expected output characteristics**
- [ ] No wardrobe "tops" item included (same category as the product)
- [ ] At least one suggestion uses Black Chinos or Khaki Trousers (complementary formality)
- [ ] Brown Derby Shoes preferred over White Sneakers in formal-leaning outfit
- [ ] 1–3 distinct outfit suggestions returned, each with a styleNote

**Actual result** *(tested 2026-04-29, evaluator: FengqiHu)*
Three outfits returned, none included the Oxford Shirt (same category as blazer). Two used Black Chinos + Brown Derby Shoes; one used Khaki Trousers + Brown Derby Shoes. All had one-sentence styleNotes. No ID hallucination observed.

**Verdict: PASS**

---

## Component 4 — Outfit Completion

### Case OC-01: Missing outerwear and shoes filled appropriately

**Input conditions**
- Selected items: White Oxford Shirt (tops) + Dark Denim Jeans (pants)
- Missing categories: outerwear, shoes, accessories
- Candidates: Rain Jacket (outerwear), Wool Overcoat (outerwear), White Sneakers (shoes), Brown Derby Shoes (shoes), Silver Watch (accessories)

**Expected output characteristics**
- [ ] Exactly one item recommended per missing category
- [ ] Wool Overcoat OR Rain Jacket selected for outerwear (not both)
- [ ] Recommended items have IDs that exactly match the candidate list (no hallucination)
- [ ] styleNote describes a coherent overall outfit vibe

**Actual result** *(tested 2026-04-29, evaluator: FengqiHu)*
Wool Overcoat selected for outerwear, Brown Derby Shoes for shoes, Silver Watch for accessories. All IDs matched the candidate list exactly. styleNote: "A smart-casual look that pairs crisp Oxford shirting with relaxed denim, grounded by a tailored coat." One item per category, no duplicates.

**Verdict: PASS**

---

## Component 5 — Virtual Try-On Image Generation

### Case TRY-01: Outfit image preserves user identity

**Input conditions**
- Body image: full-body photo of user (uploaded)
- Clothing items: Grey Merino Sweater (tops) + Dark Denim Jeans (pants)
- No headshot provided

**Expected output characteristics**
- [ ] Generated image shows the same person as the body reference (face, skin tone, body shape preserved)
- [ ] Person is visibly wearing both specified clothing items
- [ ] Background is neutral and non-distracting
- [ ] Image is photorealistic (not stylized or illustrated)
- [ ] No obvious artifacts (floating limbs, duplicate garments, wrong proportions)

**Actual result** *(tested 2026-04-28, evaluator: ZeliMa776)*
Identity preserved (face and body shape matched reference). Both sweater and jeans visible. Neutral grey background. Photorealistic rendering. Minor seam artifact at left shoulder but no structural errors. Overall quality acceptable for product demo.

**Verdict: PASS** (minor artifact noted, not a blocking failure)

---

### Case TRY-02: Headshot improves face fidelity

**Input conditions**
- Body image: full-body photo of user
- Headshot image: close-up face photo of same user
- Clothing items: Navy Blazer (tops) + Black Chinos (pants)

**Expected output characteristics**
- [ ] Face in output more closely matches headshot than body image alone
- [ ] Outfit (blazer + chinos) is the primary change from the reference images
- [ ] Person's hair, skin tone, and facial features consistent with both reference images
- [ ] No identity swap or fictional face introduced

**Actual result** *(tested 2026-04-28, evaluator: ZeliMa776)*
Face fidelity noticeably improved compared to Case TRY-01 (headshot-only run). Hair and skin tone consistent. Blazer and chinos correctly rendered. No fictional identity introduced.

**Verdict: PASS**

---

## Failure Modes Observed

| Case | Failure mode | Severity | Status |
|---|---|---|---|
| ORA-02 | Model described Wool Overcoat as "waterproof" in reason field | Minor (cosmetic) | Accepted |
| TRY-01 | Seam artifact at left shoulder | Minor (cosmetic) | Accepted |

---

## Summary

| Component | Cases | Pass | Fail |
|---|---|---|---|
| Outfit recommendation agent | 5 | 5 | 0 |
| Style preference summary | 2 | 2 | 0 |
| Shop outfit pairing | 1 | 1 | 0 |
| Outfit completion | 1 | 1 | 0 |
| Virtual try-on image | 2 | 2 | 0 |
| **Total** | **11** | **11** | **0** |

Two minor cosmetic issues observed (ORA-02 reason field inaccuracy, TRY-01 shoulder artifact). Neither constitutes a functional failure. All core behavioral requirements — weather awareness, accessory mode enforcement, identity preservation, category compliance — passed evaluation.
