import type { StructuredDocument } from "../core/StructuredDocument.js";

export interface SaveResult {
  location: string;
}

export interface OutputProvider {
  save(document: StructuredDocument): Promise<SaveResult>;
}

export interface PathResolver {
  resolve(document: StructuredDocument): string;
}
