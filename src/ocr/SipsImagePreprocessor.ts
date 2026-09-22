import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ImagePreprocessor, PreparedImage } from "./ImagePreprocessor.js";

const execFileAsync = promisify(execFile);

export class SipsImagePreprocessor implements ImagePreprocessor {
  constructor(private readonly workDirectory: string, private readonly command = "sips") {}

  async prepare(imagePath: string): Promise<PreparedImage> {
    if (![".heic", ".heif"].includes(path.extname(imagePath).toLowerCase())) return { path: imagePath };
    await mkdir(this.workDirectory, { recursive: true });
    const outputPath = path.join(this.workDirectory, `${path.basename(imagePath)}.ocr.jpg`);
    try {
      await execFileAsync(this.command, ["-s", "format", "jpeg", imagePath, "--out", outputPath]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`HEIC conversion failed for ${imagePath}: ${message}`);
    }
    return { path: outputPath, cleanup: async () => rm(outputPath, { force: true }) };
  }
}
