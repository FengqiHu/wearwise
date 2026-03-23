import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/auth-context";
import { deleteClosetItem, fetchClosetItems, importTestClosetItems } from "../lib/api";
import { cn } from "../lib/cn";
import {
  CLOTHING_CATEGORIES,
  type ClothingCategory,
  type ClothingItem
} from "../types";

type WardrobeFilter = "all" | ClothingCategory;

function sortByNewest(items: ClothingItem[]): ClothingItem[] {
  return [...items].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

interface SampleClosetItem {
  imageUrl: string;
  analysisStatus: "pending" | "ready" | "error";
  analysisError: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function WardrobePage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<WardrobeFilter>("all");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

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

      const items = (await response.json()) as SampleClosetItem[];
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Sample clothes data is empty.");
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

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl text-boutique-900">My Wardrobe</h1>
          <p className="mt-1 text-sm text-boutique-700">Browse, filter, and inspect your uploaded clothing items.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void handleImportTestData()} disabled={isImporting || isLoading}>
            {isImporting ? "Importing..." : "Add test data"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/add")}>
            Add more clothes
          </Button>
        </div>
      </header>

      <Card className="space-y-5 p-5 md:p-6">
        {feedback ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {feedback}
          </div>
        ) : null}

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
              const isDeleting = deletingIds.has(item.id);

              return (
                <div key={item.id} className="relative">
                  <button
                    type="button"
                    disabled={isProcessing || isDeleting}
                    onClick={() => navigate(`/cloth/${item.id}`)}
                    className={cn(
                      "group w-full overflow-hidden rounded-2xl border border-boutique-200 bg-boutique-50 text-left shadow-sm transition",
                      isProcessing || isDeleting
                        ? "cursor-not-allowed grayscale opacity-60"
                        : "hover:-translate-y-0.5 hover:border-boutique-400 hover:shadow-soft"
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
                </div>
              );
            })}
          </div>
        )}

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
    </section>
  );
}
