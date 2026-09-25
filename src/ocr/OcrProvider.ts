export interface OcrPage {
  pageNumber: number;
  text: string;
}

export interface OcrResult {
  text: string;
  pages?: OcrPage[];
  sourceDate?: string;
}

export interface OcrProvider {
  recognize(imagePath: string): Promise<OcrResult>;
}
