#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { findImages } from "../scanner/findImages.js";
import { CacheStore } from "../cache/CacheStore.js";
import { ArchiveStore } from "../archive/ArchiveStore.js";
import { TesseractOcrProvider } from "../ocr/TesseractOcrProvider.js";
import { ImageMagickImagePreprocessor } from "../ocr/ImageMagickImagePreprocessor.js";
import { AppleVisionOcrProvider } from "../ocr/AppleVisionOcrProvider.js";
import { processImages } from "../pipeline/processImages.js";

interface CliOptions { concurrency: number; force: boolean; runtimeDir: string; language: string; ocr: "apple-vision" | "tesseract"; }

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    concurrency: 4,
    force: false,
    runtimeDir: process.env.PAPER_INBOX_HOME ?? path.join(os.homedir(), ".paper-inbox"),
    language: process.env.PAPER_INBOX_OCR_LANG ?? "jpn+eng",
    ocr: "apple-vision",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") options.force = true;
    else if (arg === "--concurrency") options.concurrency = Number(args[++index]);
    else if (arg === "--runtime-dir") options.runtimeDir = args[++index];
    else if (arg === "--lang") options.language = args[++index];
    else if (arg === "--ocr") {
      const provider = args[++index];
      if (provider !== "apple-vision" && provider !== "tesseract") throw new Error("--ocr must be apple-vision or tesseract");
      options.ocr = provider;
    }
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  return options;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "process") {
    console.error("Usage: paper-inbox process [--concurrency N] [--force] [--runtime-dir PATH] [--lang LANG]");
    process.exitCode = 1;
    return;
  }
  const options = parseOptions(args);
  const inbox = path.join(options.runtimeDir, "inbox");
  await Promise.all([mkdir(inbox, { recursive: true }), mkdir(path.join(options.runtimeDir, "work"), { recursive: true })]);
  const images = await findImages(inbox);
  console.log(`Found ${images.length} images`);
  const ocrProvider = options.ocr === "apple-vision"
    ? new AppleVisionOcrProvider({ workDirectory: path.join(options.runtimeDir, "work"), language: ["ja-JP", "en-US"] })
    : new TesseractOcrProvider({ language: options.language });
  const summary = await processImages(
    images,
    ocrProvider,
    new CacheStore(path.join(options.runtimeDir, "cache")),
    new ArchiveStore(path.join(options.runtimeDir, "archive")),
    {
      concurrency: options.concurrency,
      force: options.force,
      preprocessor: new ImageMagickImagePreprocessor(path.join(options.runtimeDir, "work")),
      onStatus: console.log,
    },
  );
  console.log("\nCompleted");
  console.log(`Total: ${summary.total}`);
  console.log(`Processed: ${summary.processed}`);
  console.log(`Cached: ${summary.cached}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Archived: ${summary.archived}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
