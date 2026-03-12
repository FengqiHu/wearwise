# Workflow — Iteration 2

## Jirui's Feature
**"Users can select specific clothes from the cloud closet and request outfit recommendations based only on the selected items."**

## Overall Plan

Two features, five tasks, executed in two waves:

```
Wave 1: #45 → #46 → #48 → verify #43
Wave 2: #49 → #50 → verify #44
```

### Wave 1 — Outfit Recommendation (Feature #43)

| Step | Issue | Type | Description | Depends On |
|------|-------|------|-------------|------------|
| 1 | #45 | task | Add wardrobe selection mode UI with per-category constraint | — |
| 2 | #46 | task | Implement POST /api/closet/recommend endpoint with Gemini structured output | — |
| 3 | #48 | task | Build outfit recommendation result panel on wardrobe page | #45, #46 |
| ✓ | #43 | feature | Verify: Select clothes and get AI outfit completion recommendation | #45, #46, #48 |

### Wave 2 — Try-On Image Generation (Feature #44)

| Step | Issue | Type | Description | Depends On |
|------|-------|------|-------------|------------|
| 4 | #49 | task | Add generateOutfit API client function to api.ts | — |
| 5 | #50 | task | Add Generate Try-On button and image display to wardrobe panel | #48, #49 |
| ✓ | #44 | feature | Verify: Generate outfit try-on image from recommended outfit | #49, #50 |

## Current Phase
**#45 complete. Ready to start #46 (can be done in parallel with or after #45 merge).**

Branch completed: `jiruidai/task/issue-45-wardrobe-selection-mode-ui`
Next branch to create: `jiruidai/task/issue-46-recommend-endpoint`

## Task Status

| Issue | Status |
|-------|--------|
| #45 | ✅ Done — selection mode UI with per-category constraint in wardrobe-page.tsx |
| #46 | 🔲 Not started |
| #48 | 🔲 Not started |
| #43 | 🔲 Not started (verify) |
| #49 | 🔲 Not started |
| #50 | 🔲 Not started |
| #44 | 🔲 Not started (verify) |

## Notes
- #45 and #46 have no mutual dependency — can be done in either order, but sequential is fine
- #48 must come after both #45 and #46 are merged
- #50 must come after both #48 and #49 are merged
- #49 may overlap with Zeli's #38 (same generateOutfit function in api.ts) — coordinate before implementing to avoid merge conflict
