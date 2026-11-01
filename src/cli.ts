#!/usr/bin/env node
import { appendMemory, createMemoryEvent, listMemory } from './memory.ts';
import type { MemoryEvent, MemoryRecovery } from './memory.ts';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initProject, loadConfig } from './config.ts';
import { createCheckpoint, verifyLatest } from './snapshot.ts';
import { storeDir } from './storage.ts';
import { codexHookCompatibility, hooksStatus, manageHooks } from './hooks/install.ts';
import { nextSession } from './next.ts';
import { contextCommand } from './telemetry/cli.ts';
import type { Agent } from './types.ts';

const HELP = `ContextBridge CLI (foundation preview)\n\n` +
  `Usage: contextbridge <command> [options]\n\n` +
  `Commands:\n` +
  `  init        Initialize local project memory\n` +
  `  status      Show configuration and latest checkpoint\n` +
  `  checkpoint  Create a checkpoint using explicitly supplied work state\n` +
  `  hooks       Install, inspect, or remove opt-in project-local Codex capture\n` +
  `  memory      Add or list local, unverified project memory\n` +
  `  context     Inspect or explicitly import local token telemetry\n` +
  `  verify      Verify the latest checkpoint checksum\n` +
  `  doctor      Check basic runtime prerequisites\n` +
  `  next        Start a fresh Codex session from the latest verified checkpoint\n` +
  `  run         Reserved: not implemented in the foundation preview\n\n` +
  `Examples:\n` +
  `  contextbridge init --agent both\n` +
  `  contextbridge checkpoint --objective "Implement authentication" --next-step "Write tests"\n` +
  `  contextbridge verify\n` +
  `  contextbridge next --agent codex [--project /path/to/project]\n\n` +
  `Memory: contextbridge memory add --type decision --text "Use MySQL"\n` +
  `        contextbridge memory list [--project /path/to/project]\n` +
  `add supports --source user-supplied|agent-reported (default: user-supplied),\n` +
  `--reference "source description", and repeated --file project/relative/path.\n` +
  `Records are local, unverified claims. Potential secrets and unsafe paths are rejected.\n` +
  `Hooks: contextbridge hooks install|status|uninstall --agent codex [--project PATH]\n` +
  `       install requires --yes (explicit opt-in), or use --dry-run; uninstall supports --dry-run.\n` +
  `       Review installed hook definitions in Codex /hooks before use.\n` +
  `Context: contextbridge context status [--project PATH] [--session ID --thread ID]\n` +
  `         contextbridge context ingest --source codex-app-server --source-version 0.166.0\n` +
  `           --session ID --observed-at UTC_ISO_TIMESTAMP --sequence INTEGER --yes [--project PATH]\n` +
  `         ingest reads one bounded notification from stdin; live capture is not implemented.\n` +
  `next requires --agent codex and an installed Codex CLI on PATH.\n` +
  `It runs interactively in the selected project (default: current directory).\n` +
  `Claude handoff, automatic rollover, and live token monitoring are not implemented.\n`;

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

function reportRecovery(recovery?: MemoryRecovery): void {
  for (const item of recovery?.recovered ?? []) console.error(`Recovered complete journal tail at byte ${item.offset}: ${item.id}.`);
  for (const item of recovery?.abandoned ?? []) console.error(`Journal record at byte ${item.offset} excluded by recovery marker (SHA-256 ${item.digest}).`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (['next', 'memory', 'hooks', 'context'].includes(command) && (args.includes('--help') || args.includes('-h'))) {
    console.log(HELP);
    return;
  }
  const root = resolve(option(args, 'project', process.cwd())!);
  switch (command) {
    case 'context':
      await contextCommand(root, args);
      return;
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
      console.log(`Mode: ${config.mode} (Codex assisted next and local context import available; live monitoring pending)`);
      console.log(`Thresholds: ${config.thresholds.warning}/${config.thresholds.handoff}/${config.thresholds.safety}% (advisory only for verified active occupancy)`);
      console.log('Telemetry: use context status for independent imported streams; active context utilization is unknown.');
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
    case 'hooks': {
      const action = args[0];
      if (!['install', 'status', 'uninstall'].includes(action)) throw new Error('Use hooks install, status, or uninstall.');
      const seen = new Set<string>();
      for (let i = 1; i < args.length; i++) {
        const key = args[i];
        if (!['--agent', '--project', '--yes', '--dry-run'].includes(key) || seen.has(key)) throw new Error('Unknown or repeated hook option.');
        seen.add(key);
        if (['--agent', '--project'].includes(key)) {
          if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing hook option value.');
        }
      }
      if (option(args, 'agent') !== 'codex') throw new Error('Hooks require --agent codex. Other providers are not implemented.');
      if (action === 'status') {
        console.log(JSON.stringify({ ...await hooksStatus(root), compatibility: codexHookCompatibility('codex', root) }, null, 2));
      } else {
        if (action === 'install') {
          if (!args.includes('--yes') && !args.includes('--dry-run')) throw new Error('Installation requires explicit opt-in with --yes; preview with --dry-run.');
          const compatibility = codexHookCompatibility('codex', root);
          if (!compatibility.supported) throw new Error(compatibility.reason);
        }
        console.log(await manageHooks(root, action as 'install' | 'uninstall', args.includes('--dry-run')));
      }
      return;
    }
    case 'memory': {
      const action = args[0];
      const allowed = action === 'add' ? ['type', 'text', 'source', 'reference', 'file', 'project'] : ['project'];
      for (let i = 1; i < args.length; i += 2) {
        if (!allowed.includes(args[i].slice(2)) || !args[i].startsWith('--')) throw new Error('Unknown memory option. Use memory --help.');
        values(args, args[i].slice(2));
      }
      if (action === 'add') {
        const event = createMemoryEvent({
          type: option(args, 'type') as MemoryEvent['type'], content: option(args, 'text')!,
          source: { kind: option(args, 'source', 'user-supplied') as MemoryEvent['source']['kind'],
            ...(option(args, 'reference') !== undefined ? { reference: option(args, 'reference') } : {}) },
          ...(values(args, 'file').length ? { relatedFiles: values(args, 'file') } : {}),
        });
        reportRecovery(await appendMemory(root, event));
        console.log(`Memory recorded (unverified): ${event.id}`);
      } else if (action === 'list') {
        const result = await listMemory(root);
        console.log(JSON.stringify(result.events, null, 2));
        reportRecovery(result.recovery);
        if (result.incompleteTail) console.error('Incomplete journal tail ignored; the next add will seal it with a recovery marker.');
      } else throw new Error('Use memory add or memory list.');
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
      console.log('Codex assisted next and local context import are available. Claude handoff, automatic rollover and live token monitoring are not implemented.');
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
