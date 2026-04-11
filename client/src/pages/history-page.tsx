import { useEffect, useState } from "react";
import { Card } from "../components/ui/card";
import { ThinkingDots } from "../components/thinking-dots";
import { useAuth } from "../context/auth-context";
import { fetchRecommendationHistory } from "../lib/api";
import { cn } from "../lib/cn";
import type { RecommendationHistoryEntry, RecommendationVote } from "../types";

function voteLabel(vote: RecommendationVote | null): string {
  if (vote === "up") {
    return "Upvoted";
  }

  if (vote === "down") {
    return "Downvoted";
  }

  return "Not voted yet";
}

function voteBadgeClassName(vote: RecommendationVote | null): string {
  if (vote === "up") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (vote === "down") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-boutique-200 bg-boutique-100 text-boutique-700";
}

function sortNewestFirst(entries: RecommendationHistoryEntry[]): RecommendationHistoryEntry[] {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);

    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return right.createdAt.localeCompare(left.createdAt);
    }

    return rightTime - leftTime;
  });
}

export function HistoryPage() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<RecommendationHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setEntries([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let isActive = true;

    const loadHistory = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const history = await fetchRecommendationHistory(token);

        if (!isActive) {
          return;
        }

        setEntries(sortNewestFirst(history));
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Failed to load recommendation history.");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      isActive = false;
    };
  }, [token]);

  return (
    <section className="space-y-6">
      <header>
        <h1
          className="text-5xl font-normal leading-tight tracking-tight text-boutique-900"
          style={{ fontFamily: '"Palatino Linotype", "Book Antiqua", Georgia, serif' }}
        >
          Try-On History
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-boutique-700">
          Review your generated try-on images, weather, occasions, vote status, and the exact items.
        </p>
      </header>

      {isLoading ? (
        <Card className="flex items-center gap-3 p-6 text-boutique-700">
          <ThinkingDots />
          <span>Loading recommendation history...</span>
        </Card>
      ) : error ? (
        <Card className="border-red-200 bg-red-50 p-6 text-red-700">{error}</Card>
      ) : entries.length === 0 ? (
        <Card className="p-6">
          <h2 className="font-display text-2xl text-boutique-900">No saved recommendations yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-boutique-700">
            Ask the AI stylist for outfit ideas in chat, then come back here to review your most recent recommendations.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <Card key={entry.id} className="overflow-hidden p-0">
              <div className="grid gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
                <div className="border-b border-boutique-200 bg-boutique-100/40 p-4 lg:border-b-0 lg:border-r">
                  <p className="font-sans text-xs font-medium uppercase tracking-wide text-boutique-600">Try-On Image</p>


                  <div className="mt-3 overflow-hidden rounded-3xl border border-boutique-200 bg-white/80">
                    {entry.generation ? (
                      <img
                        src={entry.generation.imageUrl}
                        alt={`${entry.outfitName} try-on`}
                        className="aspect-[4/5] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[4/5] items-center justify-center bg-boutique-50 p-6 text-center text-sm leading-relaxed text-boutique-600">
                        Try-on image not generated yet.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-5 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-boutique-600">Outfit Recommendation</p>
                      <h2 className="mt-2 font-display text-3xl leading-tight text-boutique-900">{entry.outfitName}</h2>
                      {entry.conversationTitle ? (
                        <p className="mt-2 text-sm text-boutique-600">Session: {entry.conversationTitle}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {entry.occasions.map((occasion) => (
                        <span
                          key={`${entry.id}-${occasion}`}
                          className="rounded-full border border-boutique-200 bg-boutique-100 px-3 py-1 text-xs font-medium text-boutique-700"
                        >
                          {occasion}
                        </span>
                      ))}
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium",
                          voteBadgeClassName(entry.vote)
                        )}
                      >
                        {voteLabel(entry.vote)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-boutique-600">Why This Works</p>
                    <p className="mt-2 text-sm leading-relaxed text-boutique-800">{entry.reason}</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-boutique-600">Items In This Outfit</p>
                      <p className="text-xs text-boutique-500">{entry.items.length} item{entry.items.length === 1 ? "" : "s"}</p>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {entry.items.map((item) => (
                        <div
                          key={`${entry.id}-${item.id}`}
                          className="overflow-hidden rounded-2xl border border-boutique-200 bg-boutique-50/80"
                        >
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="aspect-square w-full object-cover"
                            />
                          ) : (
                            <div className="flex aspect-square items-center justify-center bg-boutique-100 px-4 text-center text-xs leading-relaxed text-boutique-600">
                              Item photo unavailable
                            </div>
                          )}
                          <div className="p-3">
                            <p className="text-sm font-medium text-boutique-900">{item.name}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
