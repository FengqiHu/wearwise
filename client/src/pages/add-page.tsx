import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../context/auth-context";
import { analyzeClosetItem, createClosetItem, uploadFileToPresignedUrl } from "../lib/api";

export function AddPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
  const MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024;

  const addFiles = (fileList: FileList | null): void => {
    if (!fileList) {
      return;
    }

    const incomingFiles = Array.from(fileList);
    const oversized = incomingFiles.filter((f) => f.size > MAX_FILE_SIZE_BYTES);

    if (oversized.length > 0) {
      setFeedback(`${oversized.map((f) => f.name).join(", ")} ${oversized.length === 1 ? "exceeds" : "exceed"} the 20 MB per-file limit and was not added.`);
    }

    const valid = incomingFiles.filter((f) => f.size <= MAX_FILE_SIZE_BYTES);

    setSelectedFiles((previous) => {
      const map = new Map(previous.map((file) => [`${file.name}-${file.size}`, file]));

      for (const file of valid) {
        map.set(`${file.name}-${file.size}`, file);
      }

      const next = Array.from(map.values());
      const totalSize = next.reduce((sum, f) => sum + f.size, 0);

      if (totalSize > MAX_TOTAL_SIZE_BYTES) {
        setFeedback(`Total size exceeds the 20 MB limit. Please remove some files.`);
        return previous;
      }

      return next;
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
        const { item, uploadUrl } = await createClosetItem(token, contentType);
        await uploadFileToPresignedUrl(uploadUrl, file);

        setUploadProgress(`Analyzing ${i + 1} of ${selectedFiles.length}...`);
        await analyzeClosetItem(token, item.id, contentType);
        successCount++;
      }

      setSelectedFiles([]);
      setFeedback(`${successCount} item(s) uploaded and analyzed successfully.`);
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
        <h1 className="text-5xl font-semibold text-charcoal">Add Cloth</h1>
        <p className="mt-1 text-sm text-dim">Upload one or many clothing images. WearWise will process each item in the background.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">Upload Your Clothes</CardTitle>
          <CardDescription>Batch upload is supported. Processing status will appear in My Wardrobe.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div
            className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
              isDragging ? "border-charcoal bg-[rgba(28,28,28,0.06)]" : "border-pebble bg-cream"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-xl border border-pebble bg-[rgba(28,28,28,0.04)] text-charcoal">
              <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none" aria-hidden="true">
                <rect x="6" y="11" width="36" height="26" rx="5" stroke="currentColor" strokeWidth="2.5" />
                <path d="M18 24L22 28L31 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <p className="text-sm text-dim">Drag and drop your clothing photos here, or click below to select files.</p>

            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                Choose Files
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

          {selectedFiles.length > 0 ? (
            <div className="rounded-xl border border-pebble bg-cream p-4">
              <p className="mb-3 text-sm font-medium text-charcoal">Selected files ({selectedFiles.length})</p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {selectedFiles.map((file) => {
                  const previewUrl = URL.createObjectURL(file);
                  return (
                    <div key={`${file.name}-${file.size}`} className="group relative">
                      <div className="aspect-square overflow-hidden rounded-xl border border-pebble bg-[rgba(28,28,28,0.04)]">
                        <img
                          src={previewUrl}
                          alt={file.name}
                          className="h-full w-full object-cover"
                          onLoad={() => URL.revokeObjectURL(previewUrl)}
                        />
                      </div>
                      <p className="mt-1 truncate text-xs text-dim">{file.name}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {feedback ? <p className="text-sm text-dim">{feedback}</p> : null}

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button
              variant="primary"
              onClick={() => void startUpload()}
              disabled={selectedFiles.length === 0 || isUploading}
              className="flex-1"
            >
              {uploadProgress ?? (isUploading ? "Uploading..." : "Upload")}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => navigate("/wardrobe")}
              className="flex-1"
            >
              Go to My Wardrobe
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
