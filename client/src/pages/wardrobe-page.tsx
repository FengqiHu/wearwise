import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/auth-context";
import { fetchClosetItems } from "../lib/api";
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

export function WardrobePage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<WardrobeFilter>("all");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Map<ClothingCategory, ClothingItem>>(
    new Map<ClothingCategory, ClothingItem>()
  );

  function toggleSelection(item: ClothingItem): void {
    if (item.status === "unfinished") {
      return;
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
  }

  function exitSelectionMode(): void {
    setSelectionMode(false);
    setSelectedItems(new Map<ClothingCategory, ClothingItem>());
  }

  function handleSelectionModeToggle(): void {
    if (selectionMode) {
      exitSelectionMode();
      return;
    }

    setSelectionMode(true);
  }

  function handleGetRecommendations(): void {
    // TODO(#48): Wire outfit recommendation request using selectedItems.
  }

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

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl text-boutique-900">My Wardrobe</h1>
          <p className="mt-1 text-sm text-boutique-700">Browse, filter, and inspect your uploaded clothing items.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/add")}>
            Add more clothes
          </Button>
          <Button variant={selectionMode ? "primary" : "outline"} onClick={handleSelectionModeToggle}>
            {selectionMode ? "Cancel selection" : "Select Clothes"}
          </Button>
        </div>
      </header>

      <Card className="space-y-5 p-5 md:p-6">
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

        {selectionMode ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-boutique-300 bg-boutique-100/95 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-boutique-900">Selection mode active</p>
              <p className="text-sm text-boutique-700">
                {coveredCategories.length === 0
                  ? "No categories selected yet."
                  : coveredCategories.map((category) => `${category} \u2713`).join(", ")}
              </p>
              <p className="text-xs text-boutique-700">{selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} selected</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={selectedItems.size === 0} onClick={handleGetRecommendations}>
                Get Recommendations
              </Button>
              <Button size="sm" variant="outline" onClick={exitSelectionMode}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

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

              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    if (selectionMode) {
                      toggleSelection(item);
                      return;
                    }

                    navigate(`/cloth/${item.id}`);
                  }}
                  aria-pressed={selectionMode ? isSelected : undefined}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-boutique-200 bg-boutique-50 text-left shadow-sm transition",
                    isProcessing
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

                  {selectionMode && isSelected ? (
                    <div className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-boutique-900 text-xs font-semibold text-boutique-50 shadow-soft">
                      {"\u2713"}
                    </div>
                  ) : null}

                  {isProcessing ? (
                    <div className="absolute inset-0 grid place-items-center bg-boutique-900/20">
                      <span className="rounded-full bg-boutique-50 px-3 py-1 text-xs font-medium text-boutique-800">Processing</span>
                    </div>
                  ) : null}
                </button>
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
