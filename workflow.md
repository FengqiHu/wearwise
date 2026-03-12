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
**Wave 1 tasks #45, #46, #48 all complete. Ready to open PRs and verify #43.**

Branches completed:
- `jiruidai/task/issue-45-wardrobe-selection-mode-ui`
- `jiruidai/task/issue-46-gemini-recommend-structed-output`
- `jiruidai/task/issue-48-bulid-recommendation-result-panel` ← current branch (includes #45 + #46 code)

Next steps:
1. Open PRs for #45, #46, #48 → merge into iteration1
2. Switch to `jiruidai/feature/issue-43-...` verify branch and run end-to-end verification
3. Then start Wave 2: #49 → #50 → verify #44

## Task Status

| Issue | Status |
|-------|--------|
| #45 | ✅ Done — selection mode UI with per-category constraint in wardrobe-page.tsx |
| #46 | ✅ Done — POST /api/closet/recommend endpoint with GeminiRecommendationService |
| #48 | ✅ Done — recommendation result panel (styleNote, outfit grid, "Your pick"/"AI suggested" badges) + bug fixes |
| #43 | 🔲 Not started (verify, pending PR merges) |
| #49 | 🔲 Not started |
| #50 | 🔲 Not started |
| #44 | 🔲 Not started (verify) |

## Notes
- #45 and #46 have no mutual dependency — were done in either order, now both pushed
- #48 must come after both #45 and #46 are merged into iteration1
- #50 must come after both #48 and #49 are merged
- #49 may overlap with Zeli's #38 (same generateOutfit function in api.ts) — coordinate before implementing to avoid merge conflict
