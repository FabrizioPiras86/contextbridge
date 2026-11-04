// Test-only argument adapter. It runs real children and never fabricates results.
module.exports = function(executable, script, bin) {
  const cp = require('node:child_process');
  const path = require('node:path');
  for (const method of ['spawn', 'spawnSync']) {
    const original = cp[method];
    cp[method] = function(exe, args, options) {
      if ((exe === 'codex' && process.env.PATH === bin) ||
          path.resolve(exe).toLowerCase() === executable.toLowerCase()) {
        args = [script, ...args];
      }
      return original.call(this, exe, args, options);
    };
  }
  require('node:module').syncBuiltinESMExports();
};
