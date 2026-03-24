import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/auth-context";
import { analyzeClosetItem, deleteClosetItem, fetchClosetItem, replaceClosetItemImage, uploadFileToPresignedUrl } from "../lib/api";
import type { ClosetItemRecord } from "../types";

export function ClothDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { token } = useAuth();
  const [item, setItem] = useState<ClosetItemRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceStatus, setReplaceStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!token || !id) {
      return;
    }

    let active = true;

    const load = async (): Promise<void> => {
      try {
        setIsLoading(true);
        const fetched = await fetchClosetItem(token, id);
        if (active) {
          setItem(fetched);
        }
      } catch {
        if (active) {
          setNotFound(true);
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
  }, [token, id]);

  const handleDelete = async (): Promise<void> => {
    if (!token || !item) return;
    if (!window.confirm(`Delete "${item.name ?? "this item"}"? This cannot be undone.`)) return;

    setIsDeleting(true);
    try {
      await deleteClosetItem(token, item.id);
      navigate("/wardrobe");
    } catch {
      alert("Failed to delete item. Please try again.");
      setIsDeleting(false);
    }
  };

  const handleReplaceFile = async (file: File): Promise<void> => {
    if (!token || !item) return;

    setIsReplacing(true);
    setReplaceStatus("Uploading new image...");

    try {
      const contentType = file.type || "image/jpeg";
      const { item: updated, uploadUrl } = await replaceClosetItemImage(token, item.id, contentType);
      await uploadFileToPresignedUrl(uploadUrl, file);

      setReplaceStatus("Analyzing new image...");
      await analyzeClosetItem(token, updated.id, contentType);

      const refreshed = await fetchClosetItem(token, updated.id);
      setItem(refreshed);
      setReplaceStatus(null);
    } catch {
      alert("Failed to replace image. Please try again.");
      setReplaceStatus(null);
    } finally {
      setIsReplacing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="space-y-4 p-8 text-center">
          <p className="text-sm text-boutique-700">Loading...</p>
        </Card>
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="space-y-4 p-8 text-center">
          <h1 className="font-display text-4xl text-boutique-900">Clothing item not found</h1>
          <p className="text-sm text-boutique-700">The item may have been deleted or is not available in this account.</p>
          <div>
            <Button onClick={() => navigate("/wardrobe")}>Back to wardrobe</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (item.analysisStatus !== "ready") {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="space-y-4 p-8 text-center">
          <h1 className="font-display text-4xl text-boutique-900">Processing</h1>
          <p className="text-sm text-boutique-700">
            AI analysis for this clothing item is still running. Please check again in a moment.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => navigate("/wardrobe")}>Back to wardrobe</Button>
            <Button
              variant="outline"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
            >
              {isDeleting ? "Deleting..." : "Delete item"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-5xl text-boutique-900">Cloth Detail</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/wardrobe")}>
            Back
          </Button>
          <Button
            variant="outline"
            disabled={isReplacing || isDeleting}
            onClick={() => fileInputRef.current?.click()}
          >
            {isReplacing ? (replaceStatus ?? "Replacing...") : "Replace Image"}
          </Button>
          <Button
            variant="outline"
            disabled={isDeleting || isReplacing}
            onClick={() => void handleDelete()}
            className="text-red-600 hover:border-red-300 hover:bg-red-50"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleReplaceFile(file);
          e.target.value = "";
        }}
      />

      <Card className="grid gap-6 p-5 md:grid-cols-[0.95fr_1.05fr] md:p-7">
        <div className="overflow-hidden rounded-3xl border border-boutique-200 bg-boutique-100">
          <img src={item.imageUrl} alt={item.name ?? "Clothing item"} className="h-full w-full object-cover" />
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-boutique-600">Title</p>
            <h2 className="font-display text-4xl text-boutique-900">{item.name}</h2>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-boutique-600">Tags</p>
            <div className="flex flex-wrap gap-2">
              {item.tags.length > 0 ? item.tags.map((tag) => <Badge key={tag}>{tag}</Badge>) : <Badge>No tags</Badge>}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-boutique-600">Category</p>
            <p className="mt-1 text-lg font-medium text-boutique-900">{item.category}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-boutique-600">Description</p>
            <p className="mt-1 text-sm leading-relaxed text-boutique-800">{item.description}</p>
          </div>
        </div>
      </Card>
    </section>
  );
}
