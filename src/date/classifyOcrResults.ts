import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OcrPage } from "../ocr/OcrProvider.js";

export interface ClassifiedOcrRecord {
  source: string;
  sourceJson: string;
  sourceHash?: string;
  processedAt?: string;
  pageNumber?: number;
  date: string;
  sequence: number;
  label?: string;
  text: string;
}

interface OcrJsonRecord {
  source?: string;
  sourceHash?: string;
  processedAt?: string;
  text?: string;
  pages?: OcrPage[];
}

interface DateMarker {
  date: string;
  explicitSequence?: number;
  lineStart: number;
  lineEnd: number;
}

export async function classifyOcrResults(resultsDirectory: string, outputDirectory = path.join(resultsDirectory, "by-date")): Promise<number> {
  await mkdir(outputDirectory, { recursive: true });
  const entries = await readdir(resultsDirectory, { withFileTypes: true });
  let written = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    written += await classifyOcrJsonFile(path.join(resultsDirectory, entry.name), outputDirectory);
  }
  return written;
}

export async function classifyOcrJsonFile(jsonPath: string, outputDirectory: string): Promise<number> {
  const record = JSON.parse(await readFile(jsonPath, "utf8")) as OcrJsonRecord;
  const sourceJson = path.basename(jsonPath);
  if (record.pages && record.pages.length > 0) return classifyPages(record, sourceJson, outputDirectory);
  return classifyLegacyText(record, sourceJson, outputDirectory);
}

async function classifyPages(record: OcrJsonRecord, sourceJson: string, outputDirectory: string): Promise<number> {
  const pageMarkers = (record.pages ?? []).map((page) => findDateMarkers(page.text.split(/\r?\n/))[0]);
  const dateCounts = new Map<string, number>();
  for (const marker of pageMarkers) {
    if (marker) dateCounts.set(marker.date, (dateCounts.get(marker.date) ?? 0) + 1);
  }
  const dominantDate = [...dateCounts.entries()].sort((left, right) => right[1] - left[1])[0];
  const documentDate = dominantDate && dominantDate[1] >= 2 ? dominantDate[0] : undefined;
  const usedSequences = new Map<string, Set<number>>();
  let written = 0;
  for (const [index, page] of (record.pages ?? []).entries()) {
    const lines = page.text.split(/\r?\n/);
    const marker = pageMarkers[index];
    const date = marker?.date ?? documentDate ?? "_undated";
    const sequences = usedSequences.get(date) ?? new Set<number>();
    let sequence = marker?.explicitSequence ?? page.pageNumber;
    while (sequences.has(sequence)) sequence += 1;
    sequences.add(sequence);
    usedSequences.set(date, sequences);
    const text = marker ? lines.slice(marker.lineEnd + 1).join("\n").trim() : page.text.trim();
    await writeClassified(outputDirectory, date, sequence, {
      source: record.source ?? sourceJson,
      sourceJson,
      sourceHash: record.sourceHash,
      processedAt: record.processedAt,
      pageNumber: page.pageNumber,
      date,
      sequence,
      label: date === "_undated" ? `_undated.${String(sequence)}` : formatLabel(date, sequence),
      text,
    });
    written += 1;
  }
  return written;
}

async function classifyLegacyText(record: OcrJsonRecord, sourceJson: string, outputDirectory: string): Promise<number> {
  const text = record.text ?? "";
  const lines = text.split(/\r?\n/);
  const markers = findDateMarkers(lines);
  if (markers.length === 0) {
    await writeClassified(outputDirectory, "_undated", 1, {
      source: record.source ?? sourceJson,
      sourceJson,
      sourceHash: record.sourceHash,
      processedAt: record.processedAt,
      date: "_undated",
      sequence: 1,
      label: "_undated.1",
      text,
    });
    return 1;
  }

  const usedSequences = new Map<string, Set<number>>();
  let written = 0;
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const sectionText = lines.slice(marker.lineEnd + 1, next ? next.lineStart : lines.length).join("\n").trim();
    const sequences = usedSequences.get(marker.date) ?? new Set<number>();
    let sequence = marker.explicitSequence ?? 1;
    while (sequences.has(sequence)) sequence += 1;
    sequences.add(sequence);
    usedSequences.set(marker.date, sequences);
    await writeClassified(outputDirectory, marker.date, sequence, {
      source: record.source ?? sourceJson,
      sourceJson,
      sourceHash: record.sourceHash,
      processedAt: record.processedAt,
      date: marker.date,
      sequence,
      label: formatLabel(marker.date, sequence),
      text: sectionText,
    });
    written += 1;
  }
  return written;
}

function findDateMarkers(lines: string[]): DateMarker[] {
  const markers: DateMarker[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = parseDateLine(lines[index]);
    if (match) markers.push({ ...match, lineStart: index, lineEnd: index });
  }
  return markers;
}

function parseDateLine(line: string): Omit<DateMarker, "lineStart" | "lineEnd"> | undefined {
  const normalized = line.trim().replace(/[，、,:：]/g, ".").replace(/\s+/g, " ");
  const compact = normalized.match(/^(20\d{6})(?:[ .](?:[月日火水木金土曜]+[ .])?(\d+))?$/);
  if (compact) return { date: compact[1], explicitSequence: compact[2] ? Number(compact[2]) : undefined };

  const separated = normalized.match(/^(20\d{2})\s*[./年-]\s*(\d{1,2})\s*[./月-]\s*(\d{1,2})(?:\s*(?:日)?\s*[ .-]?[火水木金土日月曜]+[ .-]?(\d+)|\s*[ .-]+(\d+))?$/);
  if (!separated) return undefined;
  const [, year, month, day, weekdaySequence, plainSequence] = separated;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return undefined;
  return {
    date: `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`,
    explicitSequence: Number(weekdaySequence ?? plainSequence) || undefined,
  };
}

function formatLabel(date: string, sequence: number): string {
  return `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)}.${sequence}`;
}

async function writeClassified(outputDirectory: string, date: string, sequence: number, record: ClassifiedOcrRecord): Promise<void> {
  const directory = path.join(outputDirectory, date);
  await mkdir(directory, { recursive: true });
  const label = record.label ?? (date === "_undated" ? `_undated.${sequence}` : formatLabel(date, sequence));
  const outputPath = path.join(directory, `${label}.json`);
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  if (date !== "_undated") await upsertMarkdown(outputDirectory, date, label, record.text);
}

async function upsertMarkdown(outputDirectory: string, date: string, label: string, text: string): Promise<void> {
  const directory = path.join(outputDirectory, date);
  const markdownPath = path.join(directory, `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)}.md`);
  let existing = "";
  try {
    existing = await readFile(markdownPath, "utf8");
  } catch {
    // Create the daily file on first page.
  }
  const sections = new Map<string, string>();
  const sectionPattern = /^## (\d{4}\.\d{2}\.\d{2}\.\d+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  for (const match of existing.matchAll(sectionPattern)) sections.set(match[1], match[2].trim());
  sections.set(label, text.trim());
  const body = [...sections.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([sectionLabel, sectionText]) => `## ${sectionLabel}\n\n${sectionText}\n`)
    .join("\n");
  await writeFile(markdownPath, `# ${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)}\n\n${body}`, "utf8");
}
