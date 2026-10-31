#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initProject, loadConfig } from './config.ts';
import { createCheckpoint, verifyLatest } from './snapshot.ts';
import { storeDir } from './storage.ts';
import { nextSession } from './next.ts';
import type { Agent } from './types.ts';

const HELP = `ContextBridge CLI (foundation preview)\n\n` +
  `Usage: contextbridge <command> [options]\n\n` +
  `Commands:\n` +
  `  init        Initialize local project memory\n` +
  `  status      Show configuration and latest checkpoint\n` +
  `  checkpoint  Create a checkpoint using explicitly supplied work state\n` +
  `  verify      Verify the latest checkpoint checksum\n` +
  `  doctor      Check basic runtime prerequisites\n` +
  `  next        Start a fresh Codex session from the latest verified checkpoint\n` +
  `  run         Reserved: not implemented in the foundation preview\n\n` +
  `Examples:\n` +
  `  contextbridge init --agent both\n` +
  `  contextbridge checkpoint --objective "Implement authentication" --next-step "Write tests"\n` +
  `  contextbridge verify\n` +
  `  contextbridge next --agent codex [--project /path/to/project]\n\n` +
  `next requires --agent codex and an installed Codex CLI on PATH.\n` +
  `It runs interactively in the selected project (default: current directory).\n` +
  `Claude handoff, automatic rollover, and token monitoring are not implemented.\n`;

function values(args: string[], key: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${key}`) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        throw new Error(`Missing value for --${key}.`);
      }
      result.push(args[++i]);
    }
  }
  return result;
}

function option(args: string[], key: string, fallback?: string): string | undefined {
  return values(args, key).at(-1) ?? fallback;
}

function commandVersion(cmd: string): string {
  const result = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3_000 });
  return result.status === 0 ? (result.stdout || result.stderr).trim().split('\n')[0] : 'not available';
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'next' && (args.includes('--help') || args.includes('-h'))) {
    console.log(HELP);
    return;
  }
  const root = resolve(option(args, 'project', process.cwd())!);
  switch (command) {
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(HELP);
      return;
    case '--version':
      console.log('ContextBridge 0.0.1 (foundation preview)');
      return;
    case 'init': {
      const agent = option(args, 'agent', 'both') as Agent;
      const mode = option(args, 'mode', 'assisted');
      if (mode !== 'assisted') throw new Error('Automatic mode is planned but not implemented yet.');
      const result = await initProject(root, agent);
      console.log(result.created ? 'Project memory initialized.' : 'Project memory already initialized; no files overwritten.');
      console.log(`Storage: ${storeDir(root)}`);
      return;
    }
    case 'status': {
      const config = await loadConfig(root);
      console.log(`Agent: ${config.agent}`);
      console.log(`Mode: ${config.mode} (Codex assisted next available; token monitoring pending)`);
      console.log(`Thresholds: ${config.thresholds.warning}/${config.thresholds.handoff}/${config.thresholds.safety}% (not monitored yet)`);
      try {
        const snapshot = await verifyLatest(root);
        console.log(`Latest snapshot: ${snapshot.id}`);
        console.log(`Objective: ${snapshot.work.objective}`);
      } catch (error) {
        const statePath = join(storeDir(root), 'state.json');
        try {
          await readFile(statePath);
          throw error;
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError;
        }
        console.log('Latest snapshot: none');
      }
      return;
    }
    case 'checkpoint': {
      const objective = option(args, 'objective');
      const nextStep = option(args, 'next-step');
      if (!objective || !nextStep) throw new Error('Use --objective and --next-step.');
      const snapshot = await createCheckpoint(root, {
        objective, nextStep, decisions: values(args, 'decision'),
      });
      console.log(`Checkpoint saved: ${snapshot.id}`);
      console.log(`Handoff: ${join(storeDir(root), 'HANDOFF.md')}`);
      return;
    }
    case 'verify': {
      const snapshot = await verifyLatest(root);
      console.log(`Verified SHA-256 digest for snapshot ${snapshot.id}.`);
      return;
    }
    case 'doctor': {
      console.log(`Node.js: ${process.version}`);
      console.log(`Git: ${commandVersion('git')}`);
      console.log(`Claude Code: ${commandVersion('claude')}`);
      console.log(`Codex: ${commandVersion('codex')}`);
      console.log('Codex assisted next is available. Claude handoff, automatic rollover and token monitoring are not implemented.');
      return;
    }
    case 'next':
      process.exitCode = await nextSession(root, option(args, 'agent'));
      return;
    case 'run':
      throw new Error(`The '${command}' command is scheduled for a later milestone and is not implemented yet.`);
    default:
      throw new Error(`Unknown command '${command}'. Use --help for available commands.`);
  }
}

main().catch((error: unknown) => {
  console.error(`ContextBridge error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
