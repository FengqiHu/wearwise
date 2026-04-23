import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/auth-context";
import {
  analyzeClosetItem,
  deleteClosetItem,
  fetchClosetItem,
  replaceClosetItemImage,
  updateClosetItemMetadata
} from "../lib/api";
import { CLOTHING_CATEGORIES } from "../types";
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

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;

    let active = true;

    const load = async (): Promise<void> => {
      try {
        setIsLoading(true);
        const fetched = await fetchClosetItem(token, id);
        if (active) setItem(fetched);
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [token, id]);

  const startEditing = (): void => {
    if (!item) return;
    setEditName(item.name ?? "");
    setEditCategory(item.category ?? CLOTHING_CATEGORIES[0]);
    setEditDescription(item.description ?? "");
    setEditTags([...item.tags]);
    setTagInput("");
    setSaveError(null);
    setIsEditing(true);
  };

  const cancelEditing = (): void => {
    setIsEditing(false);
    setSaveError(null);
  };

  const addTag = (): void => {
    const tag = tagInput.trim();
    if (tag && !editTags.includes(tag)) {
      setEditTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string): void => {
    setEditTags((prev) => prev.filter((t) => t !== tag));
  };

  const saveEdits = async (): Promise<void> => {
    if (!token || !item) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const updated = await updateClosetItemMetadata(token, item.id, {
        name: editName.trim() || undefined,
        category: editCategory || undefined,
        tags: editTags,
        description: editDescription.trim() || undefined
      });
      setItem(updated);
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setIsSaving(false);
    }
  };

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
      const { item: updated } = await replaceClosetItemImage(token, item.id, file);

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
          <p className="text-sm text-dim">Loading...</p>
        </Card>
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="space-y-4 p-8 text-center">
          <h1 className="text-4xl font-semibold text-charcoal">Clothing item not found</h1>
          <p className="text-sm text-dim">The item may have been deleted or is not available in this account.</p>
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
          <h1 className="text-4xl font-semibold text-charcoal">Processing</h1>
          <p className="text-sm text-dim">
            AI analysis for this clothing item is still running. Please check again in a moment.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => navigate("/wardrobe")}>Back to wardrobe</Button>
            <Button variant="outline" disabled={isDeleting} onClick={() => void handleDelete()}>
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
        <h1 className="text-5xl font-semibold text-charcoal">Cloth Detail</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/wardrobe")}>Back</Button>
          {!isEditing && (
            <>
              <Button variant="outline" disabled={isReplacing || isDeleting} onClick={() => fileInputRef.current?.click()}>
                {isReplacing ? (replaceStatus ?? "Replacing...") : "Replace Image"}
              </Button>
              <Button variant="outline" disabled={isDeleting || isReplacing} onClick={startEditing}>
                Edit
              </Button>
              <Button
                variant="outline"
                disabled={isDeleting || isReplacing}
                onClick={() => void handleDelete()}
                className="text-red-600 hover:border-red-300 hover:bg-red-50"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </>
          )}
          {isEditing && (
            <>
              <Button variant="outline" disabled={isSaving} onClick={cancelEditing}>Cancel</Button>
              <Button disabled={isSaving} onClick={() => void saveEdits()}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </>
          )}
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
        <div className="overflow-hidden rounded-xl border border-pebble bg-[rgba(28,28,28,0.04)]">
          <img src={item.imageUrl} alt={item.name ?? "Clothing item"} className="h-full w-full object-cover" />
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-dim">Title</p>
            {isEditing ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-pebble bg-cream px-3 py-2 text-charcoal focus:outline-none focus:shadow-focus-warm"
              />
            ) : (
              <h2 className="text-4xl font-semibold text-charcoal">{item.name}</h2>
            )}
          </div>

          {/* Category */}
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-dim">Category</p>
            {isEditing ? (
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-pebble bg-cream px-3 text-sm text-charcoal focus:outline-none focus:shadow-focus-warm"
              >
                {CLOTHING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-lg font-medium text-charcoal">{item.category}</p>
            )}
          </div>

          {/* Tags */}
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-dim">Tags</p>
            {isEditing ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {editTags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded-full border border-pebble bg-[rgba(28,28,28,0.04)] px-3 py-0.5 text-sm text-charcoal">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="text-dim hover:text-red-600">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    placeholder="Add a tag..."
                    className="flex-1 rounded-lg border border-pebble bg-cream px-3 py-1.5 text-sm text-charcoal focus:outline-none focus:shadow-focus-warm"
                  />
                  <Button size="sm" variant="outline" onClick={addTag}>Add</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {item.tags.length > 0 ? item.tags.map((tag) => <Badge key={tag}>{tag}</Badge>) : <Badge>No tags</Badge>}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-dim">Description</p>
            {isEditing ? (
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-pebble bg-cream px-3 py-2 text-sm text-charcoal focus:outline-none focus:shadow-focus-warm"
              />
            ) : (
              <p className="mt-1 text-sm leading-relaxed text-charcoal">{item.description}</p>
            )}
          </div>

          {saveError ? (
            <p className="text-sm text-red-600">{saveError}</p>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
