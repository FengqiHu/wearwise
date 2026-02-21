import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import {
  CLOTHING_CATEGORIES,
  type ClothingCategory,
  type ClothingItem
} from "../types";
import { addWardrobeItems, updateWardrobeItemsStatus } from "../lib/storage";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result));
    };

    reader.onerror = () => {
      reject(new Error(`Unable to read file ${file.name}`));
    };

    reader.readAsDataURL(file);
  });
}

function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./]+$/, "");
  return withoutExtension
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagsFromTitle(title: string): string[] {
  return title
    .toLowerCase()
    .split(" ")
    .filter((segment) => segment.length > 2)
    .slice(0, 3);
}

export function AddPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<ClothingCategory>("tops");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const addFiles = (fileList: FileList | null): void => {
    if (!fileList) {
      return;
    }

    const incomingFiles = Array.from(fileList);

    setSelectedFiles((previous) => {
      const map = new Map(previous.map((file) => [`${file.name}-${file.size}`, file]));

      for (const file of incomingFiles) {
        map.set(`${file.name}-${file.size}`, file);
      }

      return Array.from(map.values());
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const startUpload = async (): Promise<void> => {
    if (selectedFiles.length === 0 || isUploading) {
      return;
    }

    setIsUploading(true);
    setFeedback(null);

    try {
      const imageUrls = await Promise.all(selectedFiles.map((file) => fileToDataUrl(file)));

      const uploadTimestamp = Date.now();
      const items: ClothingItem[] = selectedFiles.map((file, index) => {
        const title = titleFromFileName(file.name);

        return {
          id: crypto.randomUUID(),
          title: title || `Uploaded cloth ${index + 1}`,
          category,
          tags: tagsFromTitle(title || file.name),
          description: "Uploaded by user. AI analysis is running and details will appear once processing is complete.",
          imageUrl: imageUrls[index],
          status: "unfinished",
          createdAt: new Date(uploadTimestamp + index).toISOString()
        };
      });

      addWardrobeItems(items);

      const uploadedIds = items.map((item) => item.id);
      window.setTimeout(() => {
        updateWardrobeItemsStatus(uploadedIds, "finished");
      }, 7000);

      setSelectedFiles([]);
      setFeedback(`${items.length} item(s) uploaded. AI processing started.`);
    } catch {
      setFeedback("Upload failed. Please try again with valid image files.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="font-display text-5xl text-boutique-900">Add Cloth</h1>
        <p className="mt-1 text-sm text-boutique-700">Upload one or many clothing images. WearWise will process each item in the background.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">Upload Your Clothes</CardTitle>
          <CardDescription>Batch upload is supported. Processing status will appear in My Wardrobe.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div
            className={`rounded-3xl border-2 border-dashed p-8 text-center transition ${
              isDragging ? "border-boutique-600 bg-boutique-100" : "border-boutique-300 bg-boutique-50"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl border border-boutique-300 bg-boutique-100 text-boutique-800">
              <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none" aria-hidden="true">
                <rect x="6" y="11" width="36" height="26" rx="5" stroke="currentColor" strokeWidth="2.5" />
                <path d="M18 24L22 28L31 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <p className="text-sm text-boutique-700">Drag and drop your clothing photos here, or click below to select files.</p>

            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                Choose Files
              </Button>
              <Button
                onClick={() => void startUpload()}
                disabled={selectedFiles.length === 0 || isUploading}
              >
                {isUploading ? "Uploading..." : "Upload"}
              </Button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => addFiles(event.target.files)}
            />
          </div>

          <div className="grid gap-2 sm:max-w-xs">
            <label className="text-sm font-medium text-boutique-700">Category for this upload</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as ClothingCategory)}
              className="h-11 rounded-2xl border border-boutique-300 bg-boutique-50 px-3 text-sm text-boutique-900 focus:outline-none focus:ring-2 focus:ring-boutique-400"
            >
              {CLOTHING_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          {selectedFiles.length > 0 ? (
            <div className="rounded-2xl border border-boutique-200 bg-boutique-50 p-4">
              <p className="mb-2 text-sm font-medium text-boutique-800">Selected files ({selectedFiles.length})</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-boutique-700">
                {selectedFiles.map((file) => (
                  <li key={`${file.name}-${file.size}`}>{file.name}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {feedback ? <p className="text-sm text-boutique-700">{feedback}</p> : null}

          <Button variant="primary" onClick={() => navigate("/wardrobe")}>
            Go to My Wardrobe
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
