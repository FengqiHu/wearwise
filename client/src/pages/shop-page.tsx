import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ThinkingDots } from "../components/thinking-dots";
import { useAuth } from "../context/auth-context";
import { shopRecommend, shopTryOn } from "../lib/api";
import type { ShopOutfit, ShopRecommendResponse } from "../types";

function BrokenImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex aspect-square items-center justify-center bg-[rgba(28,28,28,0.04)] px-3 text-center text-xs leading-relaxed text-dim">
      {label}
    </div>
  );
}

function OutfitCard({
  outfit,
  index,
  productKey,
  token
}: {
  outfit: ShopOutfit;
  index: number;
  productKey: string;
  token: string;
}) {
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [tryOnState, setTryOnState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [tryOnImageUrl, setTryOnImageUrl] = useState<string | null>(null);
  const [tryOnError, setTryOnError] = useState<string | null>(null);

  const markBroken = (id: string) => {
    setBrokenImages((prev) => new Set(prev).add(id));
  };

  const handleGenerateTryOn = async () => {
    if (tryOnState === "loading") return;
    setTryOnState("loading");
    setTryOnError(null);

    const wardrobeItemIds = outfit.items
      .filter((item) => !item.isUserSelected)
      .map((item) => item.id);

    try {
      const imageUrl = await shopTryOn(token, productKey, wardrobeItemIds);
      setTryOnImageUrl(imageUrl);
      setTryOnState("done");
    } catch (err) {
      setTryOnError(err instanceof Error ? err.message : "Failed to generate try-on image.");
      setTryOnState("error");
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-pebble bg-[rgba(28,28,28,0.02)] px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-dim">Outfit {index + 1}</p>
        <p className="mt-1 text-sm leading-relaxed text-charcoal">{outfit.styleNote}</p>
      </div>

      <div className="p-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-dim">
          {outfit.items.length} item{outfit.items.length === 1 ? "" : "s"}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {outfit.items.map((item) => (
            <div key={`${item.id}-${item.category}`} className="overflow-hidden rounded-xl border border-pebble bg-cream">
              {brokenImages.has(item.id) || !item.imageUrl ? (
                <BrokenImagePlaceholder label={item.name} />
              ) : (
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="aspect-square w-full object-cover"
                  onError={() => markBroken(item.id)}
                />
              )}
              <div className="space-y-1 p-3">
                <p className="text-sm font-medium leading-snug text-charcoal">{item.name}</p>
                {item.isUserSelected ? (
                  <p className="text-xs text-boutique-600">New item</p>
                ) : item.reason ? (
                  <p className="text-xs leading-relaxed text-dim">{item.reason}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {tryOnState === "loading" ? (
            <div className="flex items-center gap-3 rounded-xl border border-pebble bg-cream px-4 py-3 text-sm text-dim">
              <ThinkingDots />
              <span>Generating try-on image...</span>
            </div>
          ) : null}

          {tryOnError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {tryOnError}
            </p>
          ) : null}

          {tryOnImageUrl ? (
            <div className="overflow-hidden rounded-xl border border-pebble">
              <img
                src={tryOnImageUrl}
                alt={`Try-on for outfit ${index + 1}`}
                className="w-full object-cover"
              />
            </div>
          ) : null}

          <Button
            variant={tryOnState === "done" ? "outline" : "primary"}
            className="w-full"
            disabled={tryOnState === "loading"}
            onClick={() => void handleGenerateTryOn()}
          >
            {tryOnState === "loading"
              ? "Generating..."
              : tryOnState === "done"
                ? "Regenerate Try-On"
                : "Generate Try-On"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ShopPage() {
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShopRecommendResponse | null>(null);

  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

  const handleFile = (file: File | null | undefined) => {
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("File exceeds the 20 MB limit.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (JPEG, PNG, or WebP).");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setResult(null);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFile(event.dataTransfer.files[0]);
  };

  const findOutfits = async () => {
    if (!selectedFile || !token || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const recommendations = await shopRecommend(token, selectedFile);
      setResult(recommendations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
  };

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-5xl font-semibold text-charcoal">Shop New Item</h1>
        <p className="mt-1 text-sm text-dim">
          Upload a product image to see how it pairs with clothes you already own.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">Upload a Product Image</CardTitle>
          <CardDescription>
            Drag and drop a photo of an item you are considering buying, or click to browse.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Upload / preview area */}
          {selectedFile && previewUrl ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="h-48 w-48 flex-shrink-0 overflow-hidden rounded-xl border border-pebble bg-cream">
                <img
                  src={previewUrl}
                  alt="Product preview"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-col justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-charcoal">{selectedFile.name}</p>
                  <p className="mt-0.5 text-xs text-dim">
                    {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <Button variant="outline" onClick={reset} disabled={isLoading}>
                  Choose a different image
                </Button>
              </div>
            </div>
          ) : (
            <div
              className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
                isDragging ? "border-charcoal bg-[rgba(28,28,28,0.06)]" : "border-pebble bg-cream"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
            >
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-xl border border-pebble bg-[rgba(28,28,28,0.04)] text-charcoal">
                <svg viewBox="0 0 48 48" className="h-8 w-8" fill="none" aria-hidden="true">
                  <rect x="6" y="11" width="36" height="26" rx="5" stroke="currentColor" strokeWidth="2.5" />
                  <path d="M18 24L24 18L30 24M24 18V34" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm text-dim">
                Drag and drop a product photo here, or click to select a file.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          )}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button
              variant="primary"
              onClick={() => void findOutfits()}
              disabled={!selectedFile || isLoading}
              className="flex-1"
            >
              {isLoading ? "Finding outfits..." : "Find Outfits"}
            </Button>
            {result ? (
              <Button variant="outline" onClick={reset} className="flex-1">
                Try another image
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {isLoading ? (
        <Card className="flex items-center gap-3 p-6 text-dim">
          <ThinkingDots />
          <span>Analyzing your item and finding matching outfits from your wardrobe...</span>
        </Card>
      ) : null}

      {/* Results */}
      {result && !isLoading ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-charcoal">
              Outfit Recommendations for{" "}
              <span className="text-boutique-700">{result.product.name}</span>
            </h2>
            <p className="mt-1 text-sm text-dim">
              {result.outfits.length === 1
                ? "Here is an outfit from your wardrobe that pairs well with this item."
                : `Here are ${result.outfits.length} outfits from your wardrobe that pair well with this item.`}
            </p>
          </div>

          {result.outfits.map((outfit, index) => (
            <OutfitCard
              key={index}
              outfit={outfit}
              index={index}
              productKey={result.product.key}
              token={token ?? ""}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
