import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
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
    if (path.extname(imagePath).toLowerCase() === ".pdf") return this.recognizePdf(imagePath);
    return this.recognizeFile(imagePath);
  }

  private async recognizePdf(imagePath: string): Promise<OcrResult> {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "paper-inbox-pdf-"));
    const prefix = path.join(temporaryDirectory, "page");
    try {
      // LaunchAgents have a different exec environment on macOS. Invoke the
      // converter through the system shell so PATH-based helper wrappers (for
      // example the bundled Poppler wrapper) work there as they do in a shell.
      await execFileAsync("/bin/bash", ["-c", "exec pdftoppm \"$@\"", "paper-inbox", "-r", "200", "-png", imagePath, prefix], { maxBuffer: 20 * 1024 * 1024 });
      const pages = (await readdir(temporaryDirectory)).filter((file) => file.endsWith(".png")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const texts = await Promise.all(pages.map(async (page) => (await this.recognizeFile(path.join(temporaryDirectory, page))).text));
      const file = await stat(imagePath);
      return { text: texts.join("\n\n"), sourceDate: file.birthtime.toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Tesseract OCR failed for ${imagePath}: ${message}`);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async recognizeFile(imagePath: string): Promise<OcrResult> {
    try {
      const result = await execFileAsync(this.command, [path.basename(imagePath), "stdout", "-l", this.language], {
        cwd: path.dirname(imagePath),
        maxBuffer: 20 * 1024 * 1024,
      });
      return { text: result.stdout };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Tesseract OCR failed for ${imagePath}: ${message}`);
    }
  }
}
