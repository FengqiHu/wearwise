import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/auth-context";
import {
  createPresignedImageUpload,
  deleteClosetItem,
  fetchClosetItems,
  generateOutfitByItems,
  importTestClosetItems,
  recommendOutfit,
  uploadFileToPresignedUrl
} from "../lib/api";
import { cn } from "../lib/cn";
import {
  CLOTHING_CATEGORIES,
  type ClothingCategory,
  type ClothingItem,
  type OutfitRecommendation
} from "../types";

type WardrobeFilter = "all" | ClothingCategory;

function sortByNewest(items: ClothingItem[]): ClothingItem[] {
  return [...items].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

interface SampleClosetItem {
  path?: string;
  imageUrl?: string;
  analysisStatus: "pending" | "ready" | "error";
  analysisError: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
}

function getMimeTypeFromPath(filePath: string): string {
  const normalized = filePath.toLowerCase();

  if (normalized.endsWith(".png")) {
    return "image/png";
  }

  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

export function WardrobePage() {
  const navigate = useNavigate();
  const { token } = useAuth();

  // Wardrobe list state
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<WardrobeFilter>("all");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Selection mode state (Issue #45)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Map<ClothingCategory, ClothingItem>>(
    new Map<ClothingCategory, ClothingItem>()
  );
  const [replacedCategory, setReplacedCategory] = useState<ClothingCategory | null>(null);

  // Recommendation state (Issue #48)
  const [recommendation, setRecommendation] = useState<OutfitRecommendation | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const recommendRequestId = useRef(0);

  // Try-on image generation state (Issue #50)
  const [tryOnImageUrl, setTryOnImageUrl] = useState<string | null>(null);
  const [isGeneratingTryOn, setIsGeneratingTryOn] = useState(false);
  const [tryOnError, setTryOnError] = useState<string | null>(null);

  // ── Selection mode helpers ──────────────────────────────────────────────

  function toggleSelection(item: ClothingItem): void {
    if (item.status === "unfinished") {
      return;
    }

    const currentInCategory = selectedItems.get(item.category);
    const isReplacing = Boolean(currentInCategory && currentInCategory.id !== item.id);

    if (isReplacing) {
      setReplacedCategory(item.category);
    }

    setSelectedItems((prev) => {
      const next = new Map(prev);

      if (next.get(item.category)?.id === item.id) {
        next.delete(item.category);
      } else {
        next.set(item.category, item);
      }

      return next;
    });

    setRecommendation(null);
    setRecommendError(null);
  }

  function exitSelectionMode(): void {
    recommendRequestId.current += 1;
    setSelectionMode(false);
    setSelectedItems(new Map<ClothingCategory, ClothingItem>());
    setReplacedCategory(null);
    setRecommendation(null);
    setRecommendError(null);
    setTryOnImageUrl(null);
    setTryOnError(null);
    setIsRecommending(false);
  }

  function handleSelectionModeToggle(): void {
    if (selectionMode) {
      exitSelectionMode();
      return;
    }

    setSelectionMode(true);
    setRecommendError(null);
  }

  // ── Recommendation request ──────────────────────────────────────────────

  async function handleGetRecommendations(): Promise<void> {
    if (!token) {
      setRecommendError("Authentication failed. Please sign in again.");
      return;
    }

    const selectedItemIds = Array.from(selectedItems.values()).map((item) => item.id);
    if (selectedItemIds.length === 0) {
      return;
    }

    const requestId = recommendRequestId.current + 1;
    recommendRequestId.current = requestId;

    try {
      setIsRecommending(true);
      setRecommendError(null);
      setRecommendation(null);

      const result = await recommendOutfit(token, selectedItemIds);

      if (recommendRequestId.current !== requestId) {
        return;
      }

      setRecommendation(result);
    } catch (err) {
      if (recommendRequestId.current !== requestId) {
        return;
      }

      setRecommendError(err instanceof Error ? err.message : "Failed to get outfit recommendation.");
    } finally {
      if (recommendRequestId.current === requestId) {
        setIsRecommending(false);
      }
    }
  }

  async function handleGenerateTryOn(): Promise<void> {
    if (!token || !recommendation || isGeneratingTryOn) {
      return;
    }

    const allItemIds = recommendation.outfit.map((item) => item.id);

    try {
      setIsGeneratingTryOn(true);
      setTryOnError(null);
      setTryOnImageUrl(null);

      const imageUrl = await generateOutfitByItems(token, allItemIds);
      setTryOnImageUrl(imageUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate try-on image.";
      if (message.includes("no body image")) {
        setTryOnError("Please upload a full-body photo in your profile first.");
      } else {
        setTryOnError(message);
      }
    } finally {
      setIsGeneratingTryOn(false);
    }
  }

  // ── Auto-dismiss replacement notification after 2 s ─────────────────────

  useEffect(() => {
    if (!replacedCategory) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setReplacedCategory(null);
    }, 2000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [replacedCategory]);

  // ── Load wardrobe items ─────────────────────────────────────────────────

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    const load = async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);
        const fetched = await fetchClosetItems(token);

        if (active) {
          setItems(sortByNewest(fetched));
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load wardrobe.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [token]);

  const handleDelete = async (item: ClothingItem, event: React.MouseEvent): Promise<void> => {
    event.stopPropagation();

    if (!token) return;
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;

    setDeletingIds((prev) => new Set(prev).add(item.id));

    try {
      await deleteClosetItem(token, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      alert("Failed to delete item. Please try again.");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const reloadItems = async (): Promise<void> => {
    if (!token) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const fetched = await fetchClosetItems(token);
      setItems(sortByNewest(fetched));
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportTestData = async (): Promise<void> => {
    if (!token || isImporting) {
      return;
    }

    try {
      setIsImporting(true);
      setError(null);
      setFeedback(null);

      const response = await fetch("/sample-data/sample-clothes-data.json");
      if (!response.ok) {
        throw new Error("Failed to read sample clothes data.");
      }

      const sampleItems = (await response.json()) as SampleClosetItem[];
      if (!Array.isArray(sampleItems) || sampleItems.length === 0) {
        throw new Error("Sample clothes data is empty.");
      }

      const items: Array<{
        imageUrl: string;
        analysisStatus: "pending" | "ready" | "error";
        analysisError: string | null;
        name: string | null;
        category: string | null;
        tags: string[];
        description: string | null;
        createdAt?: string;
        updatedAt?: string;
      }> = [];

      for (const sampleItem of sampleItems) {
        if (sampleItem.path) {
          const normalizedPath = sampleItem.path.startsWith("/") ? sampleItem.path : `/${sampleItem.path}`;
          const imageResponse = await fetch(normalizedPath);

          if (!imageResponse.ok) {
            throw new Error(`Failed to read sample image: ${sampleItem.path}`);
          }

          const imageBlob = await imageResponse.blob();
          const fileName = normalizedPath.split("/").pop() ?? "sample-image";
          const contentType = imageBlob.type || getMimeTypeFromPath(normalizedPath);
          const presigned = await createPresignedImageUpload(token, {
            contentType,
            folder: "closet",
            fileName
          });

          const uploadFile = new File([imageBlob], fileName, { type: contentType });

          try {
            await uploadFileToPresignedUrl(presigned.uploadUrl, uploadFile);
          } catch (uploadError) {
            const message = uploadError instanceof Error ? uploadError.message : "Unknown upload error.";
            throw new Error(`Failed to upload sample image ${fileName}: ${message}`);
          }

          items.push({
            imageUrl: presigned.publicUrl,
            analysisStatus: sampleItem.analysisStatus,
            analysisError: sampleItem.analysisError,
            name: sampleItem.name,
            category: sampleItem.category,
            tags: sampleItem.tags,
            description: sampleItem.description,
            createdAt: sampleItem.createdAt,
            updatedAt: sampleItem.updatedAt
          });
          continue;
        }

        if (sampleItem.imageUrl) {
          items.push({
            imageUrl: sampleItem.imageUrl,
            analysisStatus: sampleItem.analysisStatus,
            analysisError: sampleItem.analysisError,
            name: sampleItem.name,
            category: sampleItem.category,
            tags: sampleItem.tags,
            description: sampleItem.description,
            createdAt: sampleItem.createdAt,
            updatedAt: sampleItem.updatedAt
          });
          continue;
        }

        throw new Error("Each sample item must include either path or imageUrl.");
      }

      await importTestClosetItems(token, { items });
      await reloadItems();
      setFeedback(`${items.length} test item(s) imported into your wardrobe.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import test data.");
    } finally {
      setIsImporting(false);
    }
  };

  // ── Filter + pagination ─────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") {
      return items;
    }

    return items.filter((item) => item.category === activeFilter);
  }, [activeFilter, items]);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [activeFilter]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  const coveredCategories = useMemo(
    () => CLOTHING_CATEGORIES.filter((category) => selectedItems.has(category)),
    [selectedItems]
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl text-boutique-900">My Wardrobe</h1>
          <p className="mt-1 text-sm text-boutique-700">Browse, filter, and inspect your uploaded clothing items.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void handleImportTestData()} disabled={isImporting || isLoading}>
            {isImporting ? "Importing..." : "Add test data"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/add")}>
            Add more clothes
          </Button>
          <Button variant={selectionMode ? "primary" : "outline"} onClick={handleSelectionModeToggle}>
            {selectionMode ? "Cancel selection" : "Select Clothes"}
          </Button>
        </div>
      </header>

      <Card className="space-y-5 p-5 md:p-6">
        {feedback ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {feedback}
          </div>
        ) : null}

        {/* Category filter */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeFilter === "all" ? "primary" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("all")}
          >
            All
          </Button>
          {CLOTHING_CATEGORIES.map((category) => (
            <Button
              key={category}
              variant={activeFilter === category ? "primary" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(category)}
            >
              {category}
            </Button>
          ))}
        </div>

        {/* Selection summary bar */}
        {selectionMode ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-boutique-300 bg-boutique-100/95 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-boutique-900">Selection mode active</p>
              <p className="text-sm text-boutique-700">
                {coveredCategories.length === 0
                  ? "No categories selected yet."
                  : coveredCategories
                      .map((category) => `${category}: ${selectedItems.get(category)?.title ?? "Unknown item"} \u2713`)
                      .join(", ")}
              </p>
              {replacedCategory ? (
                <p className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs italic text-amber-800">
                  Replaced your {replacedCategory} selection
                </p>
              ) : null}
              <p className="text-xs text-boutique-700">
                {selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} selected
              </p>
              {recommendError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {recommendError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedItems.size > 0 ? (
                <Button
                  size="sm"
                  disabled={isRecommending}
                  onClick={() => void handleGetRecommendations()}
                >
                  {isRecommending ? "Getting recommendations\u2026" : "Get Outfit Recommendation"}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={exitSelectionMode}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {/* Item grid */}
        {isLoading ? (
          <div className="rounded-2xl border border-boutique-200 bg-boutique-50 p-10 text-center text-boutique-700">
            Loading your wardrobe...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-red-700">
            {error}
          </div>
        ) : pagedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-boutique-300 bg-boutique-50 p-10 text-center text-boutique-700">
            No items found for this filter.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pagedItems.map((item) => {
              const isProcessing = item.status === "unfinished";
              const isSelected = selectedItems.get(item.category)?.id === item.id;
              const isDeleting = deletingIds.has(item.id);

              return (
                <div key={item.id} className="relative">
                  <button
                    type="button"
                    disabled={isProcessing || isDeleting}
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelection(item);
                        return;
                      }

                      navigate(`/cloth/${item.id}`);
                    }}
                    aria-pressed={selectionMode ? isSelected : undefined}
                    className={cn(
                      "group w-full overflow-hidden rounded-2xl border border-boutique-200 bg-boutique-50 text-left shadow-sm transition",
                      isProcessing || isDeleting
                        ? "cursor-not-allowed grayscale opacity-60"
                        : "hover:-translate-y-0.5 hover:border-boutique-400 hover:shadow-soft",
                      selectionMode && isSelected ? "ring-2 ring-boutique-700 ring-offset-2 ring-offset-boutique-50" : null
                    )}
                  >
                    <div className="aspect-[4/5] overflow-hidden bg-boutique-100">
                      {brokenImageIds.has(item.id) ? (
                        <div className="flex h-full w-full items-center justify-center text-boutique-400 text-xs">No image</div>
                      ) : (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="h-full w-full object-cover"
                          onError={() => setBrokenImageIds((prev) => new Set(prev).add(item.id))}
                        />
                      )}
                    </div>

                    <div className="space-y-2 p-3">
                      <p className="truncate text-sm font-semibold text-boutique-900">{item.title}</p>
                      <div className="flex items-center justify-between gap-2">
                        <Badge>{item.category}</Badge>
                        {isProcessing ? <Badge className="bg-boutique-200 text-boutique-700">Processing</Badge> : null}
                      </div>
                    </div>

                    {isProcessing ? (
                      <div className="absolute inset-0 grid place-items-center bg-boutique-900/20">
                        <span className="rounded-full bg-boutique-50 px-3 py-1 text-xs font-medium text-boutique-800">Processing</span>
                      </div>
                    ) : null}
                  </button>

                  {selectionMode ? (
                    isSelected ? (
                      <div className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-boutique-900 text-xs font-semibold text-boutique-50 shadow-soft">
                        {"\u2713"}
                      </div>
                    ) : null
                  ) : (
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={(e) => void handleDelete(item, e)}
                      className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/80 text-boutique-600 shadow backdrop-blur-sm transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label="Delete item"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                        <path d="M2 4h12M6 4V2h4v2M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 ? (
          <div className="flex items-center justify-center gap-2 pt-1">
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <Button
                key={pageNumber}
                variant={pageNumber === page ? "primary" : "outline"}
                size="sm"
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}
          </div>
        ) : null}
      </Card>

      {/* Recommendation result panel */}
      {recommendation ? (
        <Card className="space-y-5 p-5 md:p-6">
          <div>
            <h2 className="font-display text-4xl text-boutique-900">Outfit Recommendation</h2>
            <p className="mt-2 rounded-2xl border border-boutique-200 bg-boutique-100/80 px-4 py-3 text-sm italic text-boutique-800">
              {recommendation.styleNote}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recommendation.outfit.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl border border-boutique-200 bg-boutique-50 shadow-sm"
              >
                <div className="aspect-[4/5] overflow-hidden bg-boutique-100">
                  {brokenImageIds.has(item.id) ? (
                    <div className="flex h-full w-full items-center justify-center text-boutique-400 text-xs">No image</div>
                  ) : (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="h-full w-full object-cover"
                      onError={() => setBrokenImageIds((prev) => new Set(prev).add(item.id))}
                    />
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <p className="truncate text-sm font-semibold text-boutique-900">{item.name}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{item.category}</Badge>
                    {item.isUserSelected ? (
                      <Badge className="bg-boutique-800 text-boutique-50">Your pick</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">AI suggested</Badge>
                    )}
                  </div>
                  {!item.isUserSelected && item.reason ? (
                    <p className="text-xs italic text-boutique-600">{item.reason}</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <div className="space-y-4">
            <Button
              disabled={isGeneratingTryOn}
              onClick={handleGenerateTryOn}
            >
              {isGeneratingTryOn ? "Generating try-on image\u2026" : "Generate Try-On Image"}
            </Button>

            {tryOnError ? (
              <p className="text-sm text-red-600">{tryOnError}</p>
            ) : null}

            {tryOnImageUrl ? (
              <div className="overflow-hidden rounded-2xl border border-boutique-200">
                <img
                  src={tryOnImageUrl}
                  alt="Virtual try-on result"
                  className="w-full object-contain"
                />
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </section>
  );
}
