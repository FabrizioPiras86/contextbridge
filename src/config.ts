import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, storeDir, writeJsonAtomic } from './storage.ts';
import type { Agent, Config } from './types.ts';

export function validateConfig(config: Config): void {
  if (config.schemaVersion !== 1) throw new Error('Unsupported configuration schema.');
  if (!['claude', 'codex', 'both'].includes(config.agent)) throw new Error('Invalid agent selection.');
  if (config.mode !== 'assisted' && config.mode !== 'auto') throw new Error('Invalid mode.');
  const { warning, handoff, safety } = config.thresholds;
  if (![warning, handoff, safety].every((n) => Number.isInteger(n))) {
    throw new Error('Thresholds must be integer percentages.');
  }
  if (!(0 < warning && warning < handoff && handoff < safety && safety <= 100)) {
    throw new Error('Thresholds must satisfy 0 < warning < handoff < safety <= 100.');
  }
  if (config.privacy.captureSourceContent !== false || config.privacy.telemetry !== false) {
    throw new Error('The starter only supports privacy-safe capture defaults.');
  }
}

export async function loadConfig(root: string): Promise<Config> {
  const config = await readJson<Config>(join(storeDir(root), 'config.json'));
  validateConfig(config);
  return config;
}

export async function initProject(root: string, agent: Agent): Promise<{ created: boolean }> {
  if (!['claude', 'codex', 'both'].includes(agent)) throw new Error('Unknown agent.');
  const configPath = join(storeDir(root), 'config.json');
  try {
    await readFile(configPath);
    return { created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const config: Config = {
    schemaVersion: 1, agent, mode: 'assisted',
    thresholds: { warning: 60, handoff: 75, safety: 90 },
    privacy: { captureSourceContent: false, telemetry: false },
  };
  validateConfig(config);
  await writeJsonAtomic(configPath, config);
  const gitignorePath = join(root, '.gitignore');
  let previous = '';
  try {
    previous = await readFile(gitignorePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!previous.split(/\r?\n/).includes('.contextbridge/')) {
    await appendFile(gitignorePath, `${previous && !previous.endsWith('\n') ? '\n' : ''}.contextbridge/\n`);
  }
  return { created: true };
}
