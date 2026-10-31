import { startCodex } from './adapters/codex.ts';
import { renderSessionPrompt } from './handoff.ts';
import { verifyLatest } from './snapshot.ts';
import type { Snapshot } from './types.ts';

// Provider selection lives outside the canonical snapshot and storage layers.
export async function nextSession(root: string, agent: string | undefined): Promise<number> {
  if (agent !== 'codex') {
    throw new Error('Use next --agent codex. Other agent handoff adapters are not implemented yet.');
  }
  let snapshot: Snapshot;
  try {
    snapshot = await verifyLatest(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('No checkpoint is available. Run init and checkpoint for this project before next. If checkpoint files are missing, restore them or create a new checkpoint.');
    }
    throw error;
  }
  const prompt = renderSessionPrompt(snapshot);
  console.log(`Starting a fresh Codex session from verified checkpoint ${snapshot.id}.`);
  const code = await startCodex(root, prompt);
  if (code !== 0) {
    console.error(`Codex exited with code ${code}. The checkpoint is unchanged; you can retry.`);
  }
  return code;
}
