import crypto from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_EXPIRY_SECONDS = 60 * 5; // 5 minutes

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const MIME_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(mimeType);
}

interface R2StorageServiceOptions {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

export class R2StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly configured: boolean;

  constructor(options: R2StorageServiceOptions) {
    const { bucket, region, endpoint, accessKeyId, secretAccessKey, publicBaseUrl } = options;
    this.configured = !!(accessKeyId && secretAccessKey && bucket && publicBaseUrl);
    this.bucket = bucket;
    this.publicBaseUrl = publicBaseUrl;

    const config: ConstructorParameters<typeof S3Client>[0] = {
      region: region || "auto",
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: accessKeyId || "unconfigured",
        secretAccessKey: secretAccessKey || "unconfigured"
      }
    };

    if (endpoint) {
      config.endpoint = endpoint;
    }

    this.s3 = new S3Client(config);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async presignClosetImageUpload(
    userId: string,
    contentType: string
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const ext = MIME_TYPE_TO_EXT[contentType] ?? "bin";
    const key = `${userId}/closet/${crypto.randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
    const publicUrl = `${this.publicBaseUrl}/${key}`;

    return { uploadUrl, publicUrl };
  }
}
