import { useEffect, useState } from "react";
import { RecommendationVoteControls } from "../components/recommendation-vote-controls";
import { Card } from "../components/ui/card";
import { ThinkingDots } from "../components/thinking-dots";
import { useAuth } from "../context/auth-context";
import { fetchRecommendationHistory, voteRecommendation } from "../lib/api";
import type { RecommendationHistoryEntry, RecommendationVote } from "../types";

type GeneratedHistoryEntry = RecommendationHistoryEntry & {
  generation: NonNullable<RecommendationHistoryEntry["generation"]>;
};

function hasGeneratedTryOn(entry: RecommendationHistoryEntry): entry is GeneratedHistoryEntry {
  return entry.generation !== null;
}

function sortNewestFirst<T extends RecommendationHistoryEntry>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);

    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }

    return rightTime - leftTime;
  });
}

export function HistoryPage() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<GeneratedHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voteStates, setVoteStates] = useState<Record<string, RecommendationVote | null>>({});
  const [voteLoadingStates, setVoteLoadingStates] = useState<Record<string, boolean>>({});
  const [voteError, setVoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setEntries([]);
      setIsLoading(false);
      setError(null);
      setVoteStates({});
      setVoteLoadingStates({});
      setVoteError(null);
      return;
    }

    let isActive = true;

    const loadHistory = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      setVoteError(null);

      try {
        const history = await fetchRecommendationHistory(token);
        const historyWithGeneratedTryOns = history.filter(hasGeneratedTryOn);

        if (!isActive) {
          return;
        }

        setEntries(sortNewestFirst(historyWithGeneratedTryOns));
        setVoteStates({});
        setVoteLoadingStates({});
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

  const handleVote = async (recommendationId: string, vote: RecommendationVote | null): Promise<void> => {
    if (!token || voteLoadingStates[recommendationId]) {
      return;
    }

    const currentEntry = entries.find((entry) => entry.id === recommendationId);
    const previousVote = voteStates[recommendationId] ?? currentEntry?.vote ?? null;

    setVoteError(null);
    setVoteStates((previous) => ({ ...previous, [recommendationId]: vote }));
    setVoteLoadingStates((previous) => ({ ...previous, [recommendationId]: true }));

    try {
      await voteRecommendation(token, recommendationId, vote);
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === recommendationId
            ? {
                ...entry,
                vote
              }
            : entry
        )
      );
    } catch (submitError) {
      setVoteStates((previous) => ({ ...previous, [recommendationId]: previousVote }));
      setVoteError(submitError instanceof Error ? submitError.message : "Failed to update vote.");
    } finally {
      setVoteLoadingStates((previous) => ({ ...previous, [recommendationId]: false }));
    }
  };

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

      {voteError ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{voteError}</Card>
      ) : null}

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
          {entries.map((entry) => {
            const currentVote = voteStates[entry.id] ?? entry.vote ?? null;
            const isVoteLoading = voteLoadingStates[entry.id] ?? false;
            const occasionText = entry.occasions.join(", ");
            const hasOccasion = occasionText.length > 0;
            const hasWeather = Boolean(entry.weather);
            const contextColumnClassName =
              hasOccasion && hasWeather ? "grid-cols-2" : "grid-cols-1";

            return (
              <Card key={entry.id} className="overflow-hidden p-0">
                <div className="grid gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="border-b border-boutique-200 bg-boutique-100/40 p-4 lg:border-b-0 lg:border-r">
                    <p className="font-sans text-xs font-medium uppercase tracking-wide text-boutique-600">Try-On Image</p>

                    <div className="mt-3 overflow-hidden rounded-3xl border border-boutique-200 bg-white/80">
                      <img
                        src={entry.generation.imageUrl}
                        alt={`${entry.outfitName} try-on`}
                        className="aspect-[4/5] w-full object-cover"
                      />
                    </div>

                    <div className="mt-4 flex justify-center rounded-2xl border border-boutique-200 bg-white/80 px-4 py-3">
                      <RecommendationVoteControls
                        vote={currentVote}
                        disabled={isVoteLoading}
                        onVote={(vote) => {
                          void handleVote(entry.id, vote);
                        }}
                      />
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

                      {(hasOccasion || hasWeather) ? (
                        <div className={`min-w-[220px] space-y-2 ${hasOccasion && hasWeather ? "sm:min-w-[360px]" : ""}`}>
                          <div className={`grid gap-x-6 text-[11px] font-medium uppercase tracking-wide text-boutique-500 ${contextColumnClassName}`}>
                            {hasOccasion ? <p>Occasion</p> : null}
                            {hasWeather ? <p>Weather</p> : null}
                          </div>
                          <div className={`grid gap-x-6 text-sm text-boutique-700 ${contextColumnClassName}`}>
                            {hasOccasion ? (
                              <p className="truncate whitespace-nowrap" title={occasionText}>
                                {occasionText}
                              </p>
                            ) : null}
                            {hasWeather ? (
                              <p className="truncate whitespace-nowrap" title={entry.weather ?? ""}>
                                {entry.weather}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
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
            );
          })}
        </div>
      )}
    </section>
  );
}
