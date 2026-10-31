import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

export interface GitInfo {
  name: string;
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
  changedFiles: string[];
  filesTruncated: boolean;
  available: boolean;
}

function git(root: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

export function getGitInfo(root: string): GitInfo {
  const commit = git(root, ['rev-parse', 'HEAD']);
  const branch = git(root, ['branch', '--show-current']);
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status === null) {
    return {
      name: basename(root), branch: null, commit: null, dirty: null,
      changedFiles: [], filesTruncated: false, available: false,
    };
  }
  const paths = status.split('\n').filter(Boolean).map((line) => line.slice(3));
  return {
    name: basename(root),
    branch: branch || null,
    commit: commit || null,
    dirty: paths.length > 0,
    changedFiles: paths.slice(0, 200),
    filesTruncated: paths.length > 200,
    available: true,
  };
}
