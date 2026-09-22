import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ClassifiedOcrRecord {
  source: string;
  sourceJson: string;
  sourceHash?: string;
  processedAt?: string;
  date: string;
  sequence: number;
  text: string;
}

interface OcrJsonRecord {
  source?: string;
  sourceHash?: string;
  processedAt?: string;
  text?: string;
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
  const text = record.text ?? "";
  const lines = text.split(/\r?\n/);
  const markers = findDateMarkers(lines);
  if (markers.length === 0) {
    await writeClassified(outputDirectory, "_undated", 1, {
      source: record.source ?? path.basename(jsonPath),
      sourceJson: path.basename(jsonPath),
      sourceHash: record.sourceHash,
      processedAt: record.processedAt,
      date: "_undated",
      sequence: 1,
      text,
    });
    return 1;
  }

  const usedSequences = new Map<string, Set<number>>();
  let written = 0;
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const textStart = marker.lineEnd + 1;
    const textEnd = next ? next.lineStart : lines.length;
    const sectionText = lines.slice(textStart, textEnd).join("\n").trim();
    const sequences = usedSequences.get(marker.date) ?? new Set<number>();
    let sequence = marker.explicitSequence ?? 1;
    while (sequences.has(sequence)) sequence += 1;
    sequences.add(sequence);
    usedSequences.set(marker.date, sequences);
    await writeClassified(outputDirectory, marker.date, sequence, {
      source: record.source ?? path.basename(jsonPath),
      sourceJson: path.basename(jsonPath),
      sourceHash: record.sourceHash,
      processedAt: record.processedAt,
      date: marker.date,
      sequence,
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
  const compact = line.trim().match(/^(20\d{6})(?:\s+(\d+))?$/);
  if (compact) return { date: compact[1], explicitSequence: compact[2] ? Number(compact[2]) : undefined };
  const separated = line.trim().match(/^(20\d{2})\s*[./年-]\s*(\d{1,2})\s*[./月-]\s*(\d{1,2})(?:\s*(?:日)?\s+(\d+))?$/);
  if (!separated) return undefined;
  const [, year, month, day, sequence] = separated;
  return {
    date: `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`,
    explicitSequence: sequence ? Number(sequence) : undefined,
  };
}

async function writeClassified(outputDirectory: string, date: string, sequence: number, record: ClassifiedOcrRecord): Promise<void> {
  const directory = path.join(outputDirectory, date);
  await mkdir(directory, { recursive: true });
  const source = record.source.replace(/[^\p{L}\p{N}._-]+/gu, "_");
  const outputPath = path.join(directory, `${source}-${String(sequence).padStart(3, "0")}.json`);
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
