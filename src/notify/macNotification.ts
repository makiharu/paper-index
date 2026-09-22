import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Best-effort notification: a notification failure must never stop OCR. */
export async function notify(title: string, message: string): Promise<void> {
  try {
    await execFileAsync("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], {
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    console.warn(`Notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
