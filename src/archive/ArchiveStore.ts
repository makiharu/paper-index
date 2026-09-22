import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

export class ArchiveStore {
  constructor(private readonly directory: string) {}

  async move(imagePath: string, date = new Date()): Promise<string> {
    const day = date.toISOString().slice(0, 10);
    const targetDirectory = path.join(this.directory, day);
    await mkdir(targetDirectory, { recursive: true });
    const target = await this.uniqueTarget(targetDirectory, path.basename(imagePath));
    await rename(imagePath, target);
    return target;
  }

  private async uniqueTarget(directory: string, filename: string): Promise<string> {
    const extension = path.extname(filename);
    const stem = path.basename(filename, extension);
    let candidate = path.join(directory, filename);
    for (let index = 1; ; index += 1) {
      try {
        const { access } = await import("node:fs/promises");
        await access(candidate);
        candidate = path.join(directory, `${stem}-${index}${extension}`);
      } catch {
        return candidate;
      }
    }
  }
}
