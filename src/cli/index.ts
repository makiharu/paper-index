#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { watch as watchDirectory } from "node:fs/promises";
import { findImages } from "../scanner/findImages.js";
import { CacheStore } from "../cache/CacheStore.js";
import { ArchiveStore } from "../archive/ArchiveStore.js";
import { TesseractOcrProvider } from "../ocr/TesseractOcrProvider.js";
import { ImageMagickImagePreprocessor } from "../ocr/ImageMagickImagePreprocessor.js";
import { AppleVisionOcrProvider } from "../ocr/AppleVisionOcrProvider.js";
import { processImages } from "../pipeline/processImages.js";

interface CliOptions { concurrency: number; force: boolean; runtimeDir: string; inbox: string; originals: string; results: string; language: string; ocr: "apple-vision" | "tesseract"; }

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    concurrency: 4,
    force: false,
    runtimeDir: process.env.PAPER_INBOX_HOME ?? path.join(os.homedir(), ".paper-inbox"),
    inbox: process.env.PAPER_INBOX_INBOX ?? path.join(process.env.PAPER_INBOX_HOME ?? path.join(os.homedir(), ".paper-inbox"), "inbox"),
    originals: process.env.PAPER_INBOX_ORIGINALS ?? path.join(process.cwd(), "originals"),
    results: process.env.PAPER_INBOX_RESULTS ?? path.join(process.cwd(), "ocr-results"),
    language: process.env.PAPER_INBOX_OCR_LANG ?? "jpn+eng",
    ocr: "apple-vision",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") options.force = true;
    else if (arg === "--concurrency") options.concurrency = Number(args[++index]);
    else if (arg === "--runtime-dir") options.runtimeDir = args[++index];
    else if (arg === "--inbox") options.inbox = args[++index];
    else if (arg === "--originals") options.originals = args[++index];
    else if (arg === "--results") options.results = args[++index];
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
  if (command !== "process" && command !== "watch") {
    console.error("Usage: paper-inbox <process|watch> [--concurrency N] [--force] [--runtime-dir PATH] [--inbox PATH] [--originals PATH] [--results PATH] [--lang LANG]");
    process.exitCode = 1;
    return;
  }
  const options = parseOptions(args);
  const processInbox = async (): Promise<void> => {
    await Promise.all([mkdir(options.inbox, { recursive: true }), mkdir(path.join(options.runtimeDir, "work"), { recursive: true })]);
    const images = await findImages(options.inbox);
    await waitForStableFiles(images);
    console.log(`Found ${images.length} images`);
    const ocrProvider = options.ocr === "apple-vision"
      ? new AppleVisionOcrProvider({ workDirectory: path.join(options.runtimeDir, "work"), language: ["ja-JP", "en-US"] })
      : new TesseractOcrProvider({ language: options.language });
    const summary = await processImages(
      images,
      ocrProvider,
      new CacheStore(options.results),
      new ArchiveStore(options.originals),
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
  };

  if (command === "process") {
    await processInbox();
    return;
  }

  await processInbox();
  console.log(`\nWatching: ${options.inbox}`);
  let scheduled: NodeJS.Timeout | undefined;
  let running = Promise.resolve();
  const schedule = (): void => {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      running = running.then(processInbox).catch((error) => console.error(error instanceof Error ? error.message : error));
    }, 2000);
  };
  for await (const event of watchDirectory(options.inbox)) {
    if (event.filename && /\.(jpg|jpeg|png|heic|heif|pdf)$/i.test(event.filename)) schedule();
  }
}

async function waitForStableFiles(files: string[]): Promise<void> {
  for (const file of files) {
    let previousSize: number | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await stat(file);
      if (previousSize === current.size) break;
      previousSize = current.size;
      await sleep(1000);
    }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
