import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { OcrProvider, OcrResult } from "./OcrProvider.js";

const execFileAsync = promisify(execFile);

export interface TesseractOcrOptions {
  command?: string;
  language?: string;
}

export class TesseractOcrProvider implements OcrProvider {
  private readonly command: string;
  private readonly language: string;

  constructor(options: TesseractOcrOptions = {}) {
    this.command = options.command ?? "tesseract";
    this.language = options.language ?? "jpn+eng";
  }

  async recognize(imagePath: string): Promise<OcrResult> {
    try {
      const result = await execFileAsync(this.command, [path.basename(imagePath), "stdout", "-l", this.language], {
        cwd: path.dirname(imagePath),
        maxBuffer: 20 * 1024 * 1024,
      });
      const file = await stat(imagePath);
      return { text: result.stdout, sourceDate: file.birthtime.toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Tesseract OCR failed for ${imagePath}: ${message}`);
    }
  }
}
