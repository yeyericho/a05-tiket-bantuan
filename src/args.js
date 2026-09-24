// Parser argumen kecil: --kunci=nilai, --kunci nilai, atau --flag.
function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Argumen tidak dikenal: ${arg}`);
    const eq = arg.indexOf('=');
    if (eq > 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[arg.slice(2)] = argv[++i];
    else out[arg.slice(2)] = true;
  }
  return out;
}

function runIdOf(opt) {
  if (typeof opt.run !== 'string' || !/^[A-Za-z0-9]{1,16}$/.test(opt.run)) {
    throw new Error('--run wajib, alfanumerik 1-16 karakter (misal run01)');
  }
  return opt.run;
}

module.exports = { parseArgs, runIdOf };
