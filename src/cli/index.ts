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
import { notify } from "../notify/macNotification.js";
import { classifyOcrResults } from "../date/classifyOcrResults.js";

interface CliOptions { concurrency: number; force: boolean; runtimeDir: string; inbox: string; originals: string; results: string; dateResults: string; language: string; ocr: "apple-vision" | "tesseract"; pollInterval: number; }

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    concurrency: 4,
    force: false,
    runtimeDir: process.env.PAPER_INBOX_HOME ?? path.join(os.homedir(), ".paper-inbox"),
    inbox: process.env.PAPER_INBOX_INBOX ?? path.join(process.env.PAPER_INBOX_HOME ?? path.join(os.homedir(), ".paper-inbox"), "inbox"),
    originals: process.env.PAPER_INBOX_ORIGINALS ?? path.join(process.cwd(), "originals"),
    results: process.env.PAPER_INBOX_RESULTS ?? path.join(process.cwd(), "ocr-results"),
    dateResults: process.env.PAPER_INBOX_DATE_RESULTS ?? path.join(process.cwd(), "ocr-results", "by-date"),
    language: process.env.PAPER_INBOX_OCR_LANG ?? "jpn+eng",
    ocr: "apple-vision",
    pollInterval: 15000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") options.force = true;
    else if (arg === "--concurrency") options.concurrency = Number(args[++index]);
    else if (arg === "--runtime-dir") options.runtimeDir = args[++index];
    else if (arg === "--inbox") options.inbox = args[++index];
    else if (arg === "--originals") options.originals = args[++index];
    else if (arg === "--results") options.results = args[++index];
    else if (arg === "--date-results") options.dateResults = args[++index];
    else if (arg === "--lang") options.language = args[++index];
    else if (arg === "--ocr") {
      const provider = args[++index];
      if (provider !== "apple-vision" && provider !== "tesseract") throw new Error("--ocr must be apple-vision or tesseract");
      options.ocr = provider;
    }
    else if (arg === "--poll-interval") options.pollInterval = Number(args[++index]) * 1000;
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!Number.isFinite(options.pollInterval) || options.pollInterval < 1000) throw new Error("--poll-interval must be at least 1 second");
  return options;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "process" && command !== "watch" && command !== "classify") {
    console.error("Usage: paper-inbox <process|watch|classify> [--concurrency N] [--force] [--runtime-dir PATH] [--inbox PATH] [--originals PATH] [--results PATH] [--date-results PATH] [--lang LANG]");
    process.exitCode = 1;
    return;
  }
  const options = parseOptions(args);
  if (command === "classify") {
    const count = await classifyOcrResults(options.results, options.dateResults);
    console.log(`Classified ${count} date sections into ${options.dateResults}`);
    return;
  }
  let failureNotificationSent = false;
  const processInbox = async (): Promise<{ total: number; processed: number; cached: number; failed: number; archived: number }> => {
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
    const classified = await classifyOcrResults(options.results, options.dateResults);
    console.log("\nCompleted");
    console.log(`Total: ${summary.total}`);
    console.log(`Processed: ${summary.processed}`);
    console.log(`Cached: ${summary.cached}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Archived: ${summary.archived}`);
    console.log(`Date sections: ${classified}`);
    if (summary.failed > 0) {
      if (!failureNotificationSent) {
        await notify("Paper Inbox: OCRエラー", `${summary.failed}件の処理に失敗しました。入力フォルダに残しています。`);
        failureNotificationSent = true;
      }
    } else if (summary.processed > 0 || summary.cached > 0) {
      failureNotificationSent = false;
      await notify("Paper Inbox: OCR完了", `${summary.processed}件をOCRし、${summary.archived}件をアーカイブしました。`);
    } else {
      failureNotificationSent = false;
    }
    return summary;
  };

  if (command === "process") {
    await processInbox();
    return;
  }

  try {
    await processInbox();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await notify("Paper Inbox: 監視開始エラー", message);
  }
  console.log(`\nWatching: ${options.inbox}`);
  let scheduled: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const schedule = (): void => {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      running = running.then(processInbox).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        await notify("Paper Inbox: 処理エラー", message);
      });
    }, 2000);
  };
  const poll = setInterval(schedule, options.pollInterval);
  try {
    for await (const event of watchDirectory(options.inbox)) {
      if (event.filename && /\.(jpg|jpeg|png|heic|heif|pdf)$/i.test(event.filename)) schedule();
    }
  } finally {
    clearInterval(poll);
  }
}

async function waitForStableFiles(files: string[]): Promise<void> {
  for (const file of files) {
    let previousSize: number | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const current = await stat(file);
        if (previousSize === current.size && current.size > 0) break;
        previousSize = current.size;
        await sleep(1000);
      } catch {
        break;
      }
    }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
