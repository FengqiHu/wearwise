# Workflow

## Branch

Based on latest `iteration1` branch.

## Environment Setup

### GEMINI_API_KEY (required for clothing attribute extraction)

The server reads the Gemini API key from the environment variable `GEMINI_API_KEY` (loaded in `server/src/config/env.ts`).
Each developer must set this locally — **never commit the key to the repo**.

**How to set it:**

1. Get your key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Add it to `server/.env` (create the file if it does not exist):
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
3. `server/.env` is already listed in `.gitignore` — confirm before committing anything.

Without this key, the `POST /api/closet/items/:id/analyze` endpoint will fail with a config error.

## Overall Plan

The overarching goal is **Issue #4**, which is decomposed into **Issue #14** and **Issue #15**.

Execution order:

```
Issue #23 → Issue #24 → Issue #14 → Issue #15 → Verify Issue #4
```

After completing #14 and #15, do a final review to confirm Issue #4 is fully satisfied.

## Related Issues

| Issue | Status | Description |
|-------|--------|-------------|
| #4    | 🔲 In Progress | Parent issue (composed of #14 + #15) |
| #14   | ✅ Done | Sub-task of #4, depends on #23 + #24 |
| #15   | ✅ Done | Sub-task of #4, to be done after #14 |
| #23   | ✅ Done | Prerequisite for #24 |
| #24   | ✅ Done | Next up, prerequisite for #14 |

## In Progress

### Issue #4 🔲

_(AC verification complete — all 4 criteria now satisfied; awaiting manual test run)_

## Completed

### Frontend fixes (no issue number) ✅

- `client/src/lib/api.ts`: added `fetchClosetItem(token, itemId)` → calls `GET /api/closet/items/:id`, returns `ClosetItemRecord`
- `client/src/pages/cloth-detail-page.tsx`: replaced localStorage lookup (`getWardrobeItems()`) with API fetch via `fetchClosetItem`; now correctly shows name/category/tags/description from MongoDB; added loading state
- `client/src/pages/add-page.tsx`: removed category dropdown selector (the `category` state and UI block) — category is determined by Gemini, not the user

## Completed

### Issue #15 ✅

- `domain.ts`: added `analysisError: string | null` to `ClosetItemRecord`
- `closet-repository.ts`: added `analysisError` to document, `create` defaults it to `null`, `toClosetItemRecord` maps it, `updateExtraction` accepts it
- `closet-routes.ts`: on extraction failure, captures error message and persists via `analysisError`; added `GET /api/closet/items/:id` detail endpoint exposing full item (including `analysisStatus` + `analysisError`) for retry/debugging

## Completed

### Issue #14 ✅

- `domain.ts`: added `"error"` to `ClosetItemStatus` union
- `closet-repository.ts`: added `updateExtraction` method (writes name/category/tags/description + analysisStatus to MongoDB via `findOneAndUpdate`)
- `closet-routes.ts`: analyze endpoint now persists extraction results — sets `analysisStatus: "ready"` on success, `"error"` on Gemini/parse failure; returns `{ item: ClosetItemRecord }`

## Completed

### Issue #23 ✅

- `gemini-extraction-service.ts` (new): fetches image from R2, converts to base64, passes as inlineData to `gemini-2.0-flash-lite-preview`
- `closet-routes.ts`: new `POST /api/closet/items/:id/analyze` endpoint
- `app.ts`: instantiates and injects `GeminiExtractionService`
- `env.ts`: adds `geminiApiKey`
- `package.json` / `package-lock.json`: adds `@google/genai` dependency

## Completed

### Issue #24 ✅

- `gemini-extraction-service.ts`: replaced free-form `string` return with `ClosetItemExtraction` typed schema
- Defined `closetItemExtractionSchema` (Zod v4): `name`, `category` (enum: tops/pants/outerwear/shoes), `tags[]`, `description`
- Used `z.toJSONSchema()` (Zod v4 built-in) + `responseMimeType: "application/json"` + `responseJsonSchema` in Gemini config
- Parse + validate `response.text` with `closetItemExtractionSchema.parse(JSON.parse(raw))` — throws on failure for `analysisStatus: "error"` handling
- `closet-routes.ts`: analyze endpoint now returns full extraction object instead of `{ description }`
- Installed `zod` dependency; `zod-to-json-schema` not needed (Zod v4 has native JSON schema support)