'use strict';
// Builds the browser bundles from client/ sources:
//   client/js/manifest.json  -> public/app.min.js   (terser, compress + mangle)
//   client/css/manifest.json -> public/style.min.css (clean-css level 1)
// and writes public/build-info.json with short content hashes for cache busting.
//
// Usage: node scripts/build-assets.js [--check]
//   --check  build in memory only and report; nothing is written.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minify } = require('terser');
const CleanCSS = require('clean-css');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const PUBLIC = path.join(ROOT, 'public');
const CHECK_ONLY = process.argv.includes('--check');

const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const kb = n => `${(n / 1024).toFixed(1)} KB`;
const shortHash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

function listFiles(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(p, ext);
    return e.name.endsWith(ext) ? [p] : [];
  });
}

// Reads a manifest and its sources. Every source file in the folder must be listed,
// so a new file can't be silently left out of the bundle.
function readSources(dir, ext) {
  const manifestPath = path.join(dir, 'manifest.json');
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${rel(manifestPath)} must be a non-empty array of paths`);
  }
  const listed = new Set();
  const files = entries.map(entry => {
    const abs = path.resolve(dir, entry);
    if (!abs.startsWith(dir + path.sep) || !abs.endsWith(ext)) throw new Error(`${rel(manifestPath)}: bad entry "${entry}"`);
    if (listed.has(abs)) throw new Error(`${rel(manifestPath)}: "${entry}" is listed twice`);
    if (!fs.existsSync(abs)) throw new Error(`${rel(manifestPath)}: "${entry}" does not exist`);
    listed.add(abs);
    return { name: rel(abs), code: fs.readFileSync(abs, 'utf8') };
  });
  const unlisted = listFiles(dir, ext).filter(p => !listed.has(path.resolve(p)));
  if (unlisted.length) throw new Error(`not in ${rel(manifestPath)}: ${unlisted.map(rel).join(', ')}`);
  return files;
}

// Concatenates sources with a newline between files and remembers where each file
// starts, so errors can be reported against the original file and line.
function bundle(files) {
  const starts = [];
  let line = 1;
  const parts = files.map(f => {
    starts.push({ name: f.name, line });
    line += f.code.split('\n').length;
    return f.code;
  });
  const locate = bundleLine => {
    let hit = starts[0];
    for (const s of starts) if (s.line <= bundleLine) hit = s;
    return `${hit.name}:${bundleLine - hit.line + 1}`;
  };
  return { code: parts.join('\n'), locate };
}

async function buildJs() {
  const files = readSources(path.join(CLIENT, 'js'), '.js');
  const { code, locate } = bundle(files);
  let result;
  try {
    // No `toplevel`: global function names must survive because index.html calls them from inline handlers.
    result = await minify(code, { compress: true, mangle: true, format: { comments: false } });
  } catch (err) {
    const where = err.line ? ` (${locate(err.line)}:${(err.col || 0) + 1})` : '';
    throw new Error(`JS build failed${where}: ${err.message}`);
  }
  return { out: result.code, inputSize: Buffer.byteLength(code), count: files.length };
}

function buildCss() {
  const files = readSources(path.join(CLIENT, 'css'), '.css');
  const { code } = bundle(files);
  const result = new CleanCSS({ level: 1, returnPromise: false }).minify(code);
  if (result.errors.length) throw new Error(`CSS build failed:\n  ${result.errors.join('\n  ')}`);
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  return { out: result.styles, inputSize: Buffer.byteLength(code), count: files.length };
}

async function main() {
  const js = await buildJs();
  const css = buildCss();
  const info = JSON.stringify({ js: shortHash(js.out), css: shortHash(css.out) }) + '\n';

  const outputs = [
    { file: path.join(PUBLIC, 'app.min.js'), data: js.out, note: `${js.count} files, ${kb(js.inputSize)} -> ${kb(Buffer.byteLength(js.out))}` },
    { file: path.join(PUBLIC, 'style.min.css'), data: css.out, note: `${css.count} files, ${kb(css.inputSize)} -> ${kb(Buffer.byteLength(css.out))}` },
    { file: path.join(PUBLIC, 'build-info.json'), data: info, note: info.trim() },
  ];

  for (const o of outputs) {
    let status = '';
    if (CHECK_ONLY) {
      const current = fs.existsSync(o.file) ? fs.readFileSync(o.file, 'utf8') : null;
      status = current === o.data ? ' [up to date]' : ' [stale - run without --check]';
    } else {
      fs.writeFileSync(o.file, o.data, 'utf8');
    }
    console.log(`${rel(o.file).padEnd(24)} ${o.note}${status}`);
  }
  console.log(CHECK_ONLY ? 'check passed (nothing written)' : 'build complete');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
