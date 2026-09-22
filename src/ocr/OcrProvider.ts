export interface OcrResult {
  text: string;
  sourceDate?: string;
}

export interface OcrProvider {
  recognize(imagePath: string): Promise<OcrResult>;
}
