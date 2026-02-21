import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { cn } from "../lib/cn";
import { getWardrobeItems } from "../lib/storage";
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
  const [items, setItems] = useState<ClothingItem[]>(() => sortByNewest(getWardrobeItems()));
  const [activeFilter, setActiveFilter] = useState<WardrobeFilter>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const refreshItems = (): void => {
      setItems(sortByNewest(getWardrobeItems()));
    };

    refreshItems();
    const timerId = window.setInterval(refreshItems, 1500);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

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

        <Button variant="outline" onClick={() => navigate("/add")}>
          Add more clothes
        </Button>
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

        {pagedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-boutique-300 bg-boutique-50 p-10 text-center text-boutique-700">
            No items found for this filter.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pagedItems.map((item) => {
              const isProcessing = item.status === "unfinished";

              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => navigate(`/cloth/${item.id}`)}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-boutique-200 bg-boutique-50 text-left shadow-sm transition",
                    isProcessing
                      ? "cursor-not-allowed grayscale opacity-60"
                      : "hover:-translate-y-0.5 hover:border-boutique-400 hover:shadow-soft"
                  )}
                >
                  <div className="aspect-[4/5] overflow-hidden bg-boutique-100">
                    <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
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
