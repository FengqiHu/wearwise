import { useEffect } from "react";

interface ImageModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function ImageModal({ src, alt, onClose }: ImageModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
        onClick={onClose}
        aria-label="Close"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
        onClick={(e) => { e.stopPropagation(); }}
      />
    </div>
  );
}
