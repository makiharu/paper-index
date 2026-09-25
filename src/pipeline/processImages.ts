import path from "node:path";
import { ArchiveStore } from "../archive/ArchiveStore.js";
import { CacheStore } from "../cache/CacheStore.js";
import type { OcrProvider } from "../ocr/OcrProvider.js";
import type { ImagePreprocessor, PreparedImage } from "../ocr/ImagePreprocessor.js";

export interface ProcessOptions {
  concurrency: number;
  force: boolean;
  preprocessor?: ImagePreprocessor;
  onStatus?: (status: string) => void;
}

export interface ProcessSummary {
  total: number;
  processed: number;
  cached: number;
  failed: number;
  archived: number;
}

export async function processImages(
  images: string[],
  provider: OcrProvider,
  cache: CacheStore,
  archive: ArchiveStore,
  options: ProcessOptions,
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { total: images.length, processed: 0, cached: 0, failed: 0, archived: 0 };
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= images.length) return;
      const imagePath = images[index];
      const label = path.basename(imagePath);
      let preparedImage: PreparedImage | undefined;
      try {
        let record = !options.force ? await cache.get(imagePath) : undefined;
        if (record && path.extname(imagePath).toLowerCase() === ".pdf" && (!record.pages || record.pages.length === 0)) {
          record = undefined;
        }
        if (record) {
          summary.cached += 1;
          options.onStatus?.(`[${index + 1}/${images.length}] ${label} - cached`);
        } else {
          preparedImage = await options.preprocessor?.prepare(imagePath);
          record = await cache.put(imagePath, await provider.recognize(preparedImage?.path ?? imagePath));
          summary.processed += 1;
          options.onStatus?.(`[${index + 1}/${images.length}] ${label} - success`);
        }
        await archive.move(imagePath, record.sourceDate ? new Date(record.sourceDate) : new Date());
        summary.archived += 1;
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        options.onStatus?.(`[${index + 1}/${images.length}] ${label} - failed: ${message}`);
      } finally {
        await preparedImage?.cleanup?.();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  return summary;
}
