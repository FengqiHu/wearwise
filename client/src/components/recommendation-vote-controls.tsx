import { cn } from "../lib/cn";
import type { RecommendationVote } from "../types";

const THUMBS_UP_ICON = "\u{1F44D}";
const THUMBS_DOWN_ICON = "\u{1F44E}";

interface RecommendationVoteControlsProps {
  vote: RecommendationVote | null;
  disabled?: boolean;
  className?: string;
  onVote: (vote: RecommendationVote | null) => void;
}

export function RecommendationVoteControls({
  vote,
  disabled = false,
  className,
  onVote
}: RecommendationVoteControlsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        aria-label="Thumbs up"
        disabled={disabled}
        onClick={() => {
          onVote(vote === "up" ? null : "up");
        }}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border text-base transition",
          disabled && "cursor-not-allowed opacity-60",
          vote === "up"
            ? "border-green-400 bg-green-100 text-green-700"
            : "border-pebble bg-cream text-dim hover:border-green-300 hover:bg-green-50 hover:text-green-600"
        )}
      >
        <span aria-hidden="true">{THUMBS_UP_ICON}</span>
      </button>
      <button
        type="button"
        aria-label="Thumbs down"
        disabled={disabled}
        onClick={() => {
          onVote(vote === "down" ? null : "down");
        }}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border text-base transition",
          disabled && "cursor-not-allowed opacity-60",
          vote === "down"
            ? "border-red-400 bg-red-100 text-red-700"
            : "border-pebble bg-cream text-dim hover:border-red-300 hover:bg-red-50 hover:text-red-600"
        )}
      >
        <span aria-hidden="true">{THUMBS_DOWN_ICON}</span>
      </button>
    </div>
  );
}
