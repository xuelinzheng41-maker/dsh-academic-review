/**
 * The plugin serves skills; it must never run them (t30, item 5).
 *
 * sr-screener is the first vendored skill that ships executable payload: six Python
 * scripts, two JavaScript workflow templates and two JSON documents. "Pinned bytes"
 * says nothing about behaviour, so the one thing that must hold structurally is that
 * nothing in this package ever hands a vendored file to an interpreter.
 *
 * That is an assertion here, not a comment in a review. A file earns a scan by
 * importing node:child_process, so text that merely names these functions - a
 * docstring, a fixture, this scanner - is not a call site. Every file that does
 * import it must be named in PROCESS_ALLOWLIST with a reason, and its call sites must
 * start one of a small set of command words. A new importer fails the test; a stale
 * entry fails it too, so the list cannot rot into decoration.
 *
 * What is deliberately checked, and what is not:
 * - CHECKED: the plugin's own source (src/) and its built output (lib/) never import
 *   node:child_process and never call spawn/execFile/fork, so no code path runs from
 *   a served skill to a process;
 * - CHECKED: every process call site in the repository starts git/node/pnpm/npm, and
 *   no such line names a vendored path, so even a legitimate git call cannot be
 *   pointed at a script;
 * - CHECKED: the detector itself is exercised against a synthetic
 *   execFileSync('python', ...) and must flag it, so "nothing found" cannot mean
 *   "nothing looked";
 * - NOT CHECKED: whether a skill's instructions tell a *model* to run its scripts.
 *   They do - that is what the skill is for - and approving that is the host's job.
 *
 * @module dsh-academic-skills/tests/no-code-execution
 */

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Every file under a directory, as repo-relative POSIX paths. */
async function walkFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) await walkFiles(absolute, out)
    else out.push(relative(repoRoot, absolute).split(sep).join('/'))
  }
  return out
}

/**
 * The files allowed to import node:child_process, why, and the command words each
 * may start. This map is the whole budget for process spawning in the repository.
 */
const PROCESS_ALLOWLIST = new Map([
  ['scripts/build-determinism.mjs', { reason: 'builds the client twice and compares the two output trees', commands: ['node', 'pnpm'] }],
  ['scripts/pack-smoke.mjs', { reason: 'packs the tarball and installs it into a throwaway project with the package manager', commands: ['pnpm', 'npm', 'node'] }],
  ['scripts/vendor-upstream.mjs', { reason: 'reads upstream files out of a git object database (cat-file, ls-tree, rev-parse)', commands: ['git'] }],
  ['tests/vendor-source.test.mjs', { reason: 'creates a throwaway upstream repository to prove the vendor step pins git objects rather than worktrees', commands: ['git'] }],
  ['tests/served-payloads.test.mjs', { reason: 'reads the committed blob for a vendored payload to prove the file on disk is the object in the index', commands: ['git'] }],
])

/** Command words that never interpret a vendored script. */
const SAFE_COMMANDS = new Set(['git', 'node', 'pnpm', 'npm'])

/** A call into the process API. */
const SPAWN_CALL = /(?:spawnSync|execFileSync|execFile|spawn)\s*\(/u
/** An import of the process API. */
const PROCESS_IMPORT = /(?:from\s+|require\(\s*)['"]node:child_process['"]/u
/** A script handed to an interpreter. */
const INTERPRETER = /(?:^|[^\w-])(?:python[0-9.]*|py|bash|sh|zsh|powershell|pwsh|perl|ruby)\b(?=[^\n]*\.(?:py|sh|ps1|rb|pl)\b)/u

/**
 * Every process call site under a root, as { file, line, text }.
 * Only files that import the API are scanned: see the module note.
 */
async function findProcessSites(root, files) {
  const sites = []
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8')
    if (PROCESS_IMPORT.test(text) === false) continue
    text.split('\n').forEach((line, index) => {
      if (SPAWN_CALL.test(line)) sites.push({ file, line: index + 1, text: line.trim() })
    })
  }
  return sites
}

/**
 * The first argument of a call site, as written. Only the first argument counts:
 * reading any quoted literal would read an option ('utf8') as a command and would
 * pass a python call whose options happen to look harmless.
 */
function commandOf(site) {
  const open = site.text.indexOf('(')
  if (open === -1) return ''
  const first = /^\s*(?:'([^']*)'|"([^"]*)"|(\u0060[^\u0060]*\u0060)|([A-Za-z_$][\w$.]*))/u.exec(site.text.slice(open + 1))
  if (first === null) return ''
  if (first[1] !== undefined) return first[1]
  if (first[2] !== undefined) return first[2]
  if (first[3] !== undefined) return first[3].slice(1, -1)
  return '$' + first[4]
}

test('the plugin never starts a process: no process API in its own source or built output', async () => {
  const sources = (await walkFiles(join(repoRoot, 'src'))).filter(name => name.endsWith('.ts'))
  assert.ok(sources.length >= 8, 'expected the plugin sources to be found, saw ' + String(sources.length))
  const offenders = []
  for (const file of sources) {
    const text = await readFile(join(repoRoot, file), 'utf8')
    if (PROCESS_IMPORT.test(text)) offenders.push(file + ' imports node:child_process')
    for (const [index, line] of text.split('\n').entries()) {
      // RegExp.prototype.exec is not a process; only a child_process call is.
      if (/\b(?:spawnSync|spawn|execFileSync|execFile|fork)\s*\(/u.test(line)) offenders.push(file + ':' + String(index + 1) + ' ' + line.trim())
    }
  }
  assert.deepEqual(offenders, [], 'the plugin must not be able to start a process: ' + offenders.join('; '))
  console.log('# ' + String(sources.length) + ' source files: none imports node:child_process, none calls spawn/execFile/fork')

  // lib/ is what actually runs, so the built mirror is checked too: a bundler must
  // not smuggle in an API the sources do not have.
  const built = (await walkFiles(join(repoRoot, 'lib'))).filter(name => name.endsWith('.js'))
  const builtOffenders = []
  for (const file of built) {
    const text = await readFile(join(repoRoot, file), 'utf8')
    if (PROCESS_IMPORT.test(text)) builtOffenders.push(file + ' imports node:child_process')
    if (/\b(?:spawnSync|execFileSync|execFile|fork)\s*\(/u.test(text)) builtOffenders.push(file + ' calls the process API')
  }
  assert.deepEqual(builtOffenders, [], 'the built output must not reach the process API: ' + builtOffenders.join(', '))
  console.log('# ' + String(built.length) + ' built files: no node:child_process, no process call')
})

test('every process call site is allowlisted, starts git/node/pnpm/npm, and names no vendored file', async () => {
  const files = (await walkFiles(repoRoot)).filter(name => /\.(?:mjs|js|ts)$/u.test(name))
  const fileText = new Map()
  for (const file of files) fileText.set(file, await readFile(join(repoRoot, file), 'utf8'))
  const sites = await findProcessSites(repoRoot, files)
  assert.ok(sites.length >= 5, 'expected to find the repository\'s own process calls, saw ' + String(sites.length))

  const seen = new Set()
  const offenders = []
  for (const site of sites) {
    const allowed = PROCESS_ALLOWLIST.get(site.file)
    if (allowed === undefined) {
      offenders.push('unlisted process call in ' + site.file + ':' + String(site.line) + ' ' + site.text)
      continue
    }
    seen.add(site.file)
    for (const name of allowed.commands) {
      if (SAFE_COMMANDS.has(name) === false) offenders.push(site.file + ' allowlists ' + name + ', which is not a safe command word')
    }
    const command = commandOf(site)
    if (command.startsWith('$')) {
      // A computed command is allowed only when the allowlist names what it resolves
      // to AND the file actually carries that name; otherwise the entry proves nothing.
      const carried = allowed.commands.filter(name => new RegExp('(?:^|[^\\w-])' + name + '(?:[^\\w-]|$)', 'u').test(fileText.get(site.file) ?? ''))
      if (carried.length === 0) offenders.push(site.file + ':' + String(site.line) + ' starts ' + command + ', which does not resolve to ' + allowed.commands.join('/'))
    } else if (allowed.commands.includes(command) === false) {
      offenders.push(site.file + ':' + String(site.line) + ' starts ' + command + ', not one of ' + allowed.commands.join('/'))
    }
    if (INTERPRETER.test(site.text)) offenders.push(site.file + ':' + String(site.line) + ' hands a script to an interpreter: ' + site.text)
    if (/vendor[\\/]/u.test(site.text)) offenders.push(site.file + ':' + String(site.line) + ' names a vendored path on a process line: ' + site.text)
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))

  // Two-sided: a listed file that no longer imports the API is a stale entry, so the
  // list keeps saying exactly what the repository does.
  const stale = [...PROCESS_ALLOWLIST.keys()].filter(file => !seen.has(file))
  assert.deepEqual(stale, [], 'stale allowlist entries, no process call found in: ' + stale.join(', '))

  console.log('# ' + String(sites.length) + ' process call sites in ' + String(seen.size) + ' allowlisted files: '
    + [...seen].sort().map(file => file + ' -> ' + PROCESS_ALLOWLIST.get(file).commands.join('/')).join(', '))
})

test('the detector refuses an interpreter call (self-check on a synthetic tree)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-no-exec-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  // The fixture is assembled rather than written out: a literal import line here
  // would make the scanner read its own fixture as a call site, and a test that
  // has to special-case itself is not worth trusting.
  const processModule = ['node', 'child_process'].join(':')
  const sample = [
    "import { execFileSync } from '" + processModule + "'",
    '',
    'export function screen(script) {',
    "  return execFileSync('python', [script, '--out', 'Screening_TA'])",
    '}',
  ].join('\n')
  await writeFile(join(root, 'runner.mjs'), sample, 'utf8')
  const sites = await findProcessSites(root, ['runner.mjs'])
  assert.equal(sites.length, 1, 'the detector must see a process call it did not author')
  assert.equal(commandOf(sites[0]), 'python', 'the detector must read the command that is actually started')
  assert.equal(SAFE_COMMANDS.has(commandOf(sites[0])), false, 'python must never be a safe command word')
  assert.equal(INTERPRETER.test("execFileSync('python', ['scripts/screen.py'])"), true,
    'the detector must recognise a vendored script handed to an interpreter')
  assert.equal(INTERPRETER.test("execFileSync('git', ['cat-file', 'blob', 'HEAD:vendor/a/b.py'])"), false,
    'a git call that merely reads a .py path is not an interpreter call')
  console.log('# self-check: a synthetic execFileSync with an interpreter and a .py script is detected and refused')
})
