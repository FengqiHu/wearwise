import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../context/auth-context";
import { createClosetItem, uploadFileToPresignedUrl } from "../lib/api";
import {
  CLOTHING_CATEGORIES,
  type ClothingCategory
} from "../types";

export function AddPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<ClothingCategory>("tops");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
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
    if (selectedFiles.length === 0 || isUploading || !token) {
      return;
    }

    setIsUploading(true);
    setFeedback(null);
    setUploadProgress(null);

    let successCount = 0;

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        if (!file) continue;

        setUploadProgress(`Uploading ${i + 1} of ${selectedFiles.length}...`);

        const contentType = file.type || "image/jpeg";
        const { uploadUrl } = await createClosetItem(token, contentType);
        await uploadFileToPresignedUrl(uploadUrl, file);
        successCount++;
      }

      setSelectedFiles([]);
      setFeedback(`${successCount} item(s) uploaded successfully. AI processing will start shortly.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setFeedback(`Upload failed after ${successCount} item(s): ${message}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
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
                {uploadProgress ?? (isUploading ? "Uploading..." : "Upload")}
              </Button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
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
