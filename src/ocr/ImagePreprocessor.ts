export interface PreparedImage {
  path: string;
  cleanup?: () => Promise<void>;
}

export interface ImagePreprocessor {
  prepare(imagePath: string): Promise<PreparedImage>;
}
