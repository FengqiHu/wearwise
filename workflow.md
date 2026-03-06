# Workflow

## Branch

Based on latest `iteration1` branch.

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
| #15   | 🔲 Not Started | Sub-task of #4, to be done after #14 |
| #23   | ✅ Done | Prerequisite for #24 |
| #24   | ✅ Done | Next up, prerequisite for #14 |

## In Progress

### Issue #15 🔲

_(Not yet started — to be done after #14)_

## Completed

### Issue #14 ✅

- `domain.ts`: added `"error"` to `ClosetItemStatus` union
- `closet-repository.ts`: added `updateExtraction` method (writes name/category/tags/description + analysisStatus to MongoDB via `findOneAndUpdate`)
- `closet-routes.ts`: analyze endpoint now persists extraction results — sets `analysisStatus: "ready"` on success, `"error"` on Gemini/parse failure; returns `{ item: ClosetItemRecord }`



### Issue #23 ✅

- `gemini-extraction-service.ts` (new): fetches image from R2, converts to base64, passes as inlineData to `gemini-2.0-flash-lite-preview`
- `closet-routes.ts`: new `POST /api/closet/items/:id/analyze` endpoint
- `app.ts`: instantiates and injects `GeminiExtractionService`
- `env.ts`: adds `geminiApiKey`
- `package.json` / `package-lock.json`: adds `@google/genai` dependency

### Issue #24 ✅

- `gemini-extraction-service.ts`: replaced free-form `string` return with `ClosetItemExtraction` typed schema
- Defined `closetItemExtractionSchema` (Zod v4): `name`, `category` (enum: tops/pants/outerwear/shoes), `tags[]`, `description`
- Used `z.toJSONSchema()` (Zod v4 built-in) + `responseMimeType: "application/json"` + `responseJsonSchema` in Gemini config
- Parse + validate `response.text` with `closetItemExtractionSchema.parse(JSON.parse(raw))` — throws on failure for `analysisStatus: "error"` handling
- `closet-routes.ts`: analyze endpoint now returns full extraction object instead of `{ description }`
- Installed `zod` dependency; `zod-to-json-schema` not needed (Zod v4 has native JSON schema support)