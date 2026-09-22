import { access, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { OcrProvider, OcrResult } from "./OcrProvider.js";

const execFileAsync = promisify(execFile);

export interface AppleVisionOcrOptions {
  workDirectory: string;
  language?: string[];
}

interface VisionOutput { text: string; }

export class AppleVisionOcrProvider implements OcrProvider {
  private readonly binaryPath: string;
  private readonly language: string[];
  private buildPromise: Promise<void> | undefined;

  constructor(private readonly options: AppleVisionOcrOptions) {
    this.binaryPath = path.join(options.workDirectory, "apple-vision-ocr");
    this.language = options.language ?? ["ja-JP", "en-US"];
  }

  async recognize(imagePath: string): Promise<OcrResult> {
    await this.ensureBuilt();
    try {
      const result = await execFileAsync(this.binaryPath, [imagePath, ...this.language], { maxBuffer: 20 * 1024 * 1024 });
      const output = JSON.parse(result.stdout) as VisionOutput;
      return { text: output.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Apple Vision OCR failed for ${imagePath}: ${message}`);
    }
  }

  private async ensureBuilt(): Promise<void> {
    if (!this.buildPromise) this.buildPromise = this.build();
    return this.buildPromise;
  }

  private async build(): Promise<void> {
    await mkdir(this.options.workDirectory, { recursive: true });
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const sourceCandidates = [
      path.resolve(moduleDirectory, "../../scripts/appleVisionOcr.swift"),
      path.resolve(moduleDirectory, "../../../scripts/appleVisionOcr.swift"),
      path.resolve(process.cwd(), "scripts/appleVisionOcr.swift"),
    ];
    let sourcePath = sourceCandidates[0];
    for (const candidate of sourceCandidates) {
      try {
        await access(candidate);
        sourcePath = candidate;
        break;
      } catch {
        // Try the next location for source and compiled layouts.
      }
    }
    try {
      const [binary, source] = await Promise.all([stat(this.binaryPath), stat(sourcePath)]);
      if (binary.mtimeMs >= source.mtimeMs) return;
    } catch {
      // Build lazily when the binary does not exist yet.
    }
    await execFileAsync("xcrun", ["--sdk", "macosx", "swiftc", sourcePath, "-o", this.binaryPath, "-framework", "Vision", "-framework", "ImageIO", "-framework", "CoreGraphics", "-framework", "PDFKit"], {
      env: {
        ...process.env,
        // Avoid root-owned/global module caches. This also makes first-run
        // compilation work in restricted environments.
        CLANG_MODULE_CACHE_PATH: path.join(os.tmpdir(), "paper-inbox-swift-module-cache"),
      },
      maxBuffer: 20 * 1024 * 1024,
    });
  }
}
