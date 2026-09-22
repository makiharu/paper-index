import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OcrResult } from "../ocr/OcrProvider.js";

export interface OcrCacheRecord extends OcrResult {
  source: string;
  sourceHash: string;
  processedAt: string;
}

export class CacheStore {
  constructor(private readonly directory: string) {}

  async get(imagePath: string): Promise<OcrCacheRecord | undefined> {
    const cachePath = this.cachePath(imagePath);
    try {
      const record = JSON.parse(await readFile(cachePath, "utf8")) as OcrCacheRecord;
      if (record.sourceHash !== await this.hash(imagePath)) return undefined;
      return record;
    } catch {
      return undefined;
    }
  }

  async put(imagePath: string, result: OcrResult): Promise<OcrCacheRecord> {
    await mkdir(this.directory, { recursive: true });
    const record: OcrCacheRecord = {
      source: path.basename(imagePath),
      sourceHash: await this.hash(imagePath),
      processedAt: new Date().toISOString(),
      ...result,
    };
    await writeFile(this.cachePath(imagePath), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  }

  private cachePath(imagePath: string): string {
    return path.join(this.directory, `${path.basename(imagePath)}.json`);
  }

  private async hash(imagePath: string): Promise<string> {
    return createHash("sha256").update(await readFile(imagePath)).digest("hex");
  }
}
