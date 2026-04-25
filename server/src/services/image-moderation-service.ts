interface VisionSafeSearchAnnotation {
  adult?: VisionLikelihood;
  spoof?: VisionLikelihood;
  medical?: VisionLikelihood;
  violence?: VisionLikelihood;
  racy?: VisionLikelihood;
}

interface VisionAnnotateResponse {
  responses?: Array<{
    safeSearchAnnotation?: VisionSafeSearchAnnotation;
    error?: {
      message?: string;
    };
  }>;
}

const VISION_LIKELIHOOD_ORDER = [
  "UNKNOWN",
  "VERY_UNLIKELY",
  "UNLIKELY",
  "POSSIBLE",
  "LIKELY",
  "VERY_LIKELY"
] as const;

type VisionLikelihood = (typeof VISION_LIKELIHOOD_ORDER)[number];

const VISION_LIKELIHOOD_RANK: Record<VisionLikelihood, number> = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5
};

const SAFE_SEARCH_POLICY = [
  { key: "adult", label: "adult", minimum: "POSSIBLE" },
  { key: "violence", label: "violent", minimum: "POSSIBLE" },
  { key: "racy", label: "sexually suggestive", minimum: "VERY_LIKELY" }
] as const satisfies ReadonlyArray<{
  key: keyof VisionSafeSearchAnnotation;
  label: string;
  minimum: VisionLikelihood;
}>;

interface ImageModerationServiceOptions {
  apiKey: string;
  timeoutMs?: number;
}

export class ImageModerationRejectedError extends Error {
  readonly findings: string[];
  readonly annotation: VisionSafeSearchAnnotation;

  constructor(message: string, findings: string[], annotation: VisionSafeSearchAnnotation) {
    super(message);
    this.name = "ImageModerationRejectedError";
    this.findings = findings;
    this.annotation = annotation;
  }
}

export class ImageModerationUnavailableError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ImageModerationUnavailableError";
    this.cause = cause;
  }
}

function isAtLeast(likelihood: VisionLikelihood | undefined, minimum: VisionLikelihood): boolean {
  if (!likelihood) {
    return false;
  }

  return VISION_LIKELIHOOD_RANK[likelihood] >= VISION_LIKELIHOOD_RANK[minimum];
}

function findPolicyViolations(annotation: VisionSafeSearchAnnotation): string[] {
  return SAFE_SEARCH_POLICY
    .filter(({ key, minimum }) => isAtLeast(annotation[key], minimum))
    .map(({ label }) => label);
}

export class ImageModerationService {
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: ImageModerationServiceOptions) {
    this.apiKey = options.apiKey.trim();
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async reviewImage(buffer: Buffer): Promise<VisionSafeSearchAnnotation> {
    if (!this.isConfigured()) {
      throw new ImageModerationUnavailableError(
        "Image review is temporarily unavailable. Please try uploading again later."
      );
    }

    let response: Response;

    try {
      response = await fetch("https://vision.googleapis.com/v1/images:annotate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: buffer.toString("base64")
              },
              features: [{ type: "SAFE_SEARCH_DETECTION" }]
            }
          ]
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new ImageModerationUnavailableError(
        "Image review is temporarily unavailable. Please try uploading again later.",
        error
      );
    }

    if (!response.ok) {
      throw new ImageModerationUnavailableError(
        "Image review is temporarily unavailable. Please try uploading again later.",
        `Vision API status ${response.status}`
      );
    }

    const payload = (await response.json()) as VisionAnnotateResponse;
    const result = payload.responses?.[0];

    if (result?.error?.message) {
      throw new ImageModerationUnavailableError(
        "Image review is temporarily unavailable. Please try uploading again later.",
        result.error.message
      );
    }

    const annotation = result?.safeSearchAnnotation;
    if (!annotation) {
      throw new ImageModerationUnavailableError(
        "Image review is temporarily unavailable. Please try uploading again later.",
        "Missing SafeSearch annotation"
      );
    }

    const findings = findPolicyViolations(annotation);

    if (findings.length > 0) {
      throw new ImageModerationRejectedError(
        "This image could not be uploaded because it appears to violate WearWise's image safety policy. Please choose a different image.",
        findings,
        annotation
      );
    }

    return annotation;
  }
}
