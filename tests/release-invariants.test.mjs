/**
 * The four release invariants (t39): the things that can ship a broken release with a
 * green gate, and the re-vendor tripwires that catch a stale document.
 *
 * Each test says what would have shipped without it, because a test nobody can justify
 * is a test the next person deletes.
 *
 *   1. Every install line in both READMEs names the version in package.json. Without it,
 *      a version bump can ship a README telling people to install the previous release -
 *      the gate stays green, because nothing about the code changed.
 *   2. The newest CHANGELOG section is a DATED heading equal to package.json. Without it,
 *      a release is cut with no entry, or an entry that still says Unreleased, and the
 *      only place a user would look for what changed is wrong.
 *   3. Every commit-looking token in the documents is a prefix of the commit the manifest
 *      pins. Without it, a re-vendor updates the tree and the manifest while prose keeps
 *      pointing at the commit we no longer ship - and the prose is what reviewers read.
 *   4. docs/UPSTREAM_INVENTORY.md is recomputed: header counts against row counts and the
 *      vendored tree, and every quoted byte size against stat(). Without it, the file
 *      slowly stops describing the tree it claims to inventory, and nothing notices
 *      because it is a document, not code.
 *
 * Documents are MEASURED, never edited: a failure here is a report for the document's
 * owner, and tolerating a half-written document to keep the gate green would defeat the
 * purpose of the invariant.
 *
 * The general form of every defect this round found, and the reason each test above says
 * what it covers: A GREEN LINE THAT IMPLIES MORE COVERAGE THAN IT HAS IS THE SAME DEFECT AS
 * A STALE PIN. A pin quoting worktree bytes, a table measured on a CRLF checkout, a basis
 * paragraph that miscounts its own rows, a detector agreeing with a table that shares its
 * blind spot - in each case the report was confident and the measurement was not there. So
 * where this suite cannot measure something, it says so in the pass line rather than
 * leaving the reader to infer that green means everything was checked.
 *
 * @module dsh-academic-review/tests/release-invariants
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * DSH_DOC_FIXTURE_ROOT exists so each invariant can be mutated against a COPY of the
 * documents without writing to the repository, and so a failure can be reproduced against
 * a different revision of the same documents. It affects nothing else in this file.
 */
const repoRoot = process.env.DSH_DOC_FIXTURE_ROOT ?? fileURLToPath(new URL('..', import.meta.url))

/** The documents that describe the current tree, in both languages plus the specs. */
const CURRENT_DOCS = ['README.md', 'README.zh-CN.md', join('docs', 'UPSTREAM_INVENTORY.md'), join('docs', 'PORT_SPEC.md')]

/** A release version, as SemVer writes it. */
const VERSION = /(\d+\.\d+\.\d+)/u

async function packageJson() {
  return JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
}

async function linesOf(doc) {
  return (await readFile(join(repoRoot, doc), 'utf8')).split('\n')
}

/** Every file under a directory, as POSIX paths relative to it. */
async function walk(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isDirectory()) out.push(...await walk(join(dir, entry.name), relativePath))
    else out.push(relativePath)
  }
  return out
}

/**
 * The heading a line falls under, tracked so a test can tell current prose from history.
 * An upgrade note that says "0.2.0 -> 0.3.0" quotes the release it is describing, which
 * is by definition not the current one; treating those lines as current would make the
 * documents unfixable rather than wrong.
 */
function sectionTracker() {
  let heading = ''
  return {
    feed(line) {
      if (/^#{1,6}\s/u.test(line)) heading = line.trim()
      return heading
    },
    get current() {
      return heading
    },
  }
}

function isHistoryHeading(heading) {
  return /\d+\.\d+\.\d+\s*(?:->|\u2192|\u2190)/u.test(heading) || /\bupgrad/iu.test(heading)
}

test('every install line names the version in package.json, in both languages', async () => {
  const { version } = await packageJson()

  // What an INSTALL INSTRUCTION is, defined rather than guessed at: a line that names THIS
  // package or repository AND carries a package-manager command. qa-gate proved the old
  // shape - the literal words "dsh plugin ... add" - missed `dsh plugin install <repo>@0.3.9`,
  // which would hand the reader a different release while the guard stayed green.
  // Naming the package is what stops this parsing every sentence that contains "install";
  // the command shape stops it parsing prose that merely mentions the package. The deliberate
  // unversioned line stays legal and stays SEEN - it is an instruction, just not a pinned one.
  const COMMAND = /\b(?:dsh\s+plugin\b[^\n]*?\b(?:add|install)\b|(?:pnpm|npm|yarn)\s+(?:add|install|i)\b)/u
  const PACKAGE_NAME = 'dsh-academic-review'

  const perDoc = {}
  for (const doc of ['README.md', 'README.zh-CN.md']) {
    const lines = await linesOf(doc)
    const tracker = sectionTracker()
    const installLines = []
    lines.forEach((line, index) => {
      const heading = tracker.feed(line)
      if (COMMAND.test(line) === false || line.includes(PACKAGE_NAME) === false) return
      // History sections quote the release they describe; the current install lines do not.
      if (isHistoryHeading(heading)) return
      const target = line.trim().split(/\s+/u).pop()
      // A version is named as a tag ref ("#v0.4.0"), a tarball ("-0.4.0.tgz") or a package
      // range ("@0.3.9"); all three are pins the reader will act on.
      const tags = [...line.matchAll(/[#@]v?(\d+\.\d+\.\d+)|-(\d+\.\d+\.\d+)\.(?:tgz|tar\.gz)/gu)]
        .map(found => found[1] ?? found[2])
      installLines.push({ line: index + 1, target, tags })
    })
    assert.ok(installLines.length > 0, doc + ' must contain at least one install line; none was found')

    // The unversioned instruction must be SEEN, not dropped: if the widened matcher stops
    // recognising it, the documents still read correctly while the guard quietly stops
    // covering a line it used to cover. If the documents ever remove that line on purpose,
    // this assertion is the place to change deliberately.
    assert.equal(installLines.some(install => install.tags.length === 0), true,
      doc + ' must keep a deliberate unversioned install instruction (add <repo> installs the'
      + ' default branch) and the matcher must still see it')

    // An unversioned install line is a deliberate shape: "add <repo>" installs whatever the
    // default branch is, and the documents say so out loud before offering the pinned forms.
    // Requiring a tag on every line would force a wrong edit. What must hold is that every
    // line which DOES name a version names the shipped one.
    for (const install of installLines) {
      for (const tag of install.tags) {
        assert.equal(tag, version,
          doc + ':' + String(install.line) + ' tells the reader to install ' + tag
          + ', but package.json is ' + version + ' - a release bumped the manifest and missed this line')
      }
    }

    // The count is asserted on its own, not as a by-product of the loop: a deleted install
    // line must fail even though every surviving line is correct. Two PINNED forms are
    // required - the release tag and the built tarball - so dropping either shape fails,
    // and an unversioned line alone can never satisfy this test.
    assert.ok(installLines.filter(install => install.tags.length > 0).length >= 2,
      doc + ' must keep at least two versioned install lines (a release tag and a tarball), found '
      + String(installLines.filter(install => install.tags.length > 0).length))
    assert.equal(installLines.some(install => install.target.includes('#v')), true,
      doc + ' must keep the "add <repo>#v<version>" install line')
    assert.equal(installLines.some(install => /\.(?:tgz|tar\.gz)$/u.test(install.target)), true,
      doc + ' must keep the local tarball install line')
    perDoc[doc] = installLines
  }
  console.log('# install pins: ' + Object.entries(perDoc)
    .map(([doc, installs]) => doc + ' ' + String(installs.length) + ' line(s) all at ' + version).join('; '))
})

test('the newest CHANGELOG section is a dated heading equal to package.json', async () => {
  const { version } = await packageJson()
  const lines = await linesOf('CHANGELOG.md')

  // Two release-heading shapes are legal and both must be SEEN: "## [0.4.0] - 2026-10-27" and
  // "## 0.4.0 - 2026-10-27". qa-gate proved the bracketed-only pattern did not see the second
  // at all, so an unbracketed "## 0.9.9 - 2026-10-28" could sit above the real newest section
  // and the file would still be called correct. Because headings are collected in file order
  // and the FIRST must be the shipped version, a bracketed and an unbracketed section cannot
  // both be newest: whichever is first wins and the other can only be below it.
  const RELEASE_HEADING = /^##\s+(?:\[([^\]]+)\]|v?(\d+\.\d+\.\d+))\s*(.*)$/u
  const headings = []
  lines.forEach((line, index) => {
    const match = RELEASE_HEADING.exec(line)
    if (match === null) return
    headings.push({
      line: index + 1,
      version: (match[1] ?? match[2]).trim(),
      rest: (match[3] ?? '').trim(),
      bracketed: match[1] !== undefined,
    })
  })
  assert.ok(headings.length > 0, 'CHANGELOG.md must have at least one "## [x.y.z]" or "## x.y.z" section')

  const newest = headings[0]
  // A release that ships without a changelog entry is exactly the case nobody notices, so
  // the first section must be the version being shipped and must be DATED. "Unreleased"
  // fails here, as does a heading with no date: both mean the entry was not written for
  // the release that is going out.
  assert.equal(newest.version, version,
    'CHANGELOG.md:' + String(newest.line) + ' opens with [' + newest.version + '], but package.json is '
    + version + ' - the release has no entry of its own')
  const dated = /^-\s*(\d{4})-(\d{2})-(\d{2})$/u.exec(newest.rest)
  assert.ok(dated !== null,
    'CHANGELOG.md:' + String(newest.line) + ' must be a dated heading ("## [' + version
    + '] - YYYY-MM-DD"), found "' + newest.rest + '" - a section without a date is a draft, not a release')

  // Every versioned section - not just the newest - must be dated, so a draft heading anywhere
  // in the file cannot pass as a release note.
  const DATED = /^-\s*\d{4}-\d{2}-\d{2}$/u
  const releasable = headings.filter(heading => /^\d+\.\d+\.\d+$/u.test(heading.version))
  const undated = releasable.filter(heading => DATED.test(heading.rest) === false)
  assert.deepEqual(undated.map(heading => 'CHANGELOG.md:' + String(heading.line) + ' ["' + heading.version + '"] "'
    + heading.rest + '"'), [], 'every versioned section in CHANGELOG.md must carry a release date (YYYY-MM-DD)')

  // Two sections cannot claim the same version: a duplicated entry means one of them is a
  // stale edit, and whichever is read first decides what the file says the release contains.
  const versions = releasable.map(heading => heading.version)
  assert.equal(new Set(versions).size, versions.length,
    'CHANGELOG.md has two sections claiming the same version: ' + versions.join(', '))

  // The first section must also be the highest version, so a 0.5.0 entry inserted below a
  // 0.4.0 one cannot leave the file claiming the older release is current.
  const numeric = releasable
    .map(heading => ({ version: heading.version.split('.').map(Number), line: heading.line, text: heading.version }))
  const highest = numeric.reduce((best, heading) => {
    for (let index = 0; index < 3; index += 1) {
      if (heading.version[index] !== best.version[index]) return heading.version[index] > best.version[index] ? heading : best
    }
    return best
  })
  assert.equal(highest.text, version, 'the highest section in CHANGELOG.md must be the shipped version')
  console.log('# changelog: newest section [' + newest.version + '] ' + newest.rest + ' at line ' + String(newest.line)
    + '; ' + String(headings.length) + ' section(s) seen ('
    + String(headings.filter(heading => heading.bracketed).length) + ' bracketed, '
    + String(headings.filter(heading => heading.bracketed === false).length) + ' unbracketed), highest ' + highest.text)
})

/**
 * Commits this repository may name that are NOT the upstream pin, with the reason. Two
 * sided: an entry that stops being used fails, so the list cannot rot into a blanket
 * exemption for the file it appears in.
 */
const NON_UPSTREAM_COMMITS = {
  '4c84ffb': 'this repository\'s own commit, quoted in the port-notice history: a plugin commit is not an upstream pin',
}

test('every commit-looking token in the documents is a prefix of the pinned commit', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const pinned = manifest.upstream.commit
  assert.match(pinned, /^[0-9a-f]{40}$/u, 'the manifest must pin a full 40-hex commit')

  // What counts as commit-shaped is now qa-gate's shapes rather than the nicer ones this
  // test was written with. Two holes it proved:
  //   (a) a token SHORTER than seven hex - "deadbe" - was invisible to the old pattern,
  //       because \b[0-9a-f]{7,40}\b simply does not match it;
  //   (b) an UPPERCASE token - "1EC249DF" - was invisible too, so a WRONG uppercase pin
  //       could sit in a document for as long as anyone cared to leave it there.
  // Both are scanned now, and the comparison against the pin is case-insensitive: a commit
  // is a hex string, and its case is not a fact about the code.
  //
  // The letter requirement stays: a token of nothing but digits is a date wearing hex
  // clothes (a review_id example reads rev-20261027-<8hex>), and no test should call a date
  // a stale pin.
  const COMMIT_SHAPED = /\b[0-9a-fA-F]{6,40}\b/gu

  // Scanning six-hex tokens means scanning hex-ish noise, so the two shapes that ARE noise
  // are masked by structure and COUNTED in the pass line - not exempted by hope, and never
  // by a pattern that could swallow anything:
  //   - a review id, rev-YYYYMMDD-<hex>, which this plugin generates itself;
  //   - a digest quoted beside the word sha256, which is a hash of bytes, not a commit.
  // Masking is per line and narrow: everything else on that line is still scanned, which the
  // mutations prove by planting a stale pin beside a digest and watching it fail.
  const NOISE = [
    { shape: 'review-id', pattern: /\brev-\d{8}-[0-9a-fA-F]{6,40}\b/gu },
    { shape: 'sha256', pattern: /\bsha-?256\b\W{0,4}[0-9a-fA-F]{6,64}\b/giu },
  ]

  // A mask that could swallow the pin itself, or that masks nothing at all, would be a code
  // path nobody has watched fail. Both directions are checked here, on every run, in every
  // environment - no fixture clone, no environment variable, nothing to forget.
  for (const noise of NOISE) {
    const probe = 'pinned ' + pinned + ' rev-20261027-1a52a1cb sha256: 3f786850e387550fdab836ed7e6dc881'
    assert.equal(probe.replace(noise.pattern, '').includes(pinned), true,
      'the ' + noise.shape + ' mask must not swallow the pinned commit')
  }
  assert.equal('rev-20261027-1a52a1cb'.replace(NOISE[0].pattern, '').trim(), '',
    'the review-id mask must actually mask a review id')
  assert.equal('sha256: 3f786850e387550f'.replace(NOISE[1].pattern, '').trim(), '',
    'the sha256 mask must actually mask a quoted digest')

  const masked = {}
  const used = new Set()
  let checked = 0
  let skipped = 0

  // The pin itself must be present and full-length somewhere in every document that
  // describes the current tree - a document that stopped naming the commit cannot be stale,
  // it is silent, and silence is the failure mode this invariant exists for.
  for (const doc of CURRENT_DOCS) {
    const text = await readFile(join(repoRoot, doc), 'utf8')
    assert.equal(text.includes(pinned), true,
      doc + ' must name the pinned upstream commit ' + pinned + ' in full; it names none')
  }

  const offenders = []
  for (const doc of [...CURRENT_DOCS, 'CHANGELOG.md']) {
    const lines = await linesOf(doc)
    lines.forEach((line, index) => {
      let scanned = line
      for (const noise of NOISE) {
        scanned = scanned.replace(noise.pattern, (found) => {
          masked[noise.shape] = (masked[noise.shape] ?? 0) + 1
          return ' '.repeat(found.length)
        })
      }
      for (const match of scanned.matchAll(COMMIT_SHAPED)) {
        const token = match[0]
        if (/^[0-9]+$/u.test(token)) {
          skipped += 1
          continue
        }
        checked += 1
        const lower = token.toLowerCase()
        if (pinned.startsWith(lower)) {
          if (lower in NON_UPSTREAM_COMMITS) used.add(lower)
          continue
        }
        if (lower in NON_UPSTREAM_COMMITS) {
          used.add(lower)
          continue
        }
        // Reported with the document and the line, not as a count: the next reader has to be
        // able to tell a stale pin from a false positive without re-deriving the scan.
        offenders.push(doc + ':' + String(index + 1) + ' ' + token + ' - ' + JSON.stringify(line.trim().slice(0, 100)))
      }
    })
  }
  assert.deepEqual(offenders, [],
    'these documents name commits the manifest does not pin (' + pinned + '):\n  ' + offenders.join('\n  '))
  assert.ok(checked > 0, 'expected at least one commit-shaped token in the documents')

  // Two-sided allowlist: an exemption nobody uses any more is a silent weakening.
  const unused = Object.keys(NON_UPSTREAM_COMMITS).filter(token => used.has(token) === false)
  assert.deepEqual(unused, [], 'these NON_UPSTREAM_COMMITS entries are no longer used: ' + unused.join(', '))
  console.log('# commit pins: ' + String(checked) + ' commit-shaped token(s) (6-40 hex, any case) checked against '
    + pinned.slice(0, 12) + '; ' + String(skipped) + ' date-shaped skipped; '
    + NOISE.map(noise => String(masked[noise.shape] ?? 0) + ' ' + noise.shape).join(', ')
    + ' masked; ' + String(used.size) + ' allowlisted as this repo\'s own')
})

test('docs/UPSTREAM_INVENTORY.md is recomputed: header counts and every quoted byte size', async () => {
  const doc = join('docs', 'UPSTREAM_INVENTORY.md')
  const lines = await linesOf(doc)
  const vendorDir = join(repoRoot, 'vendor')

  // Section headers claim a file count: "## academic-paper-reviewer/ (28 files, ...)". That
  // claim has to equal both the number of rows the section lists AND the number of files
  // that section's tree actually holds - a row count alone would pass while the table lost
  // a row and the header was edited to match.
  const HEADER = /^##\s+([a-z0-9-]+)\/\s*\((\d+)\s+files/u
  const sections = []
  lines.forEach((line, index) => {
    const match = HEADER.exec(line)
    if (match !== null) sections.push({ skill: match[1], claimed: Number(match[2]), line: index + 1, rows: [], classRows: [] })
  })
  assert.ok(sections.length > 0, 'UPSTREAM_INVENTORY.md must claim a file count for at least one tree')

  const rowsBySection = sections.map(section => ({ ...section, rows: [], classRows: [] }))
  {
    let current
    lines.forEach((line, index) => {
      const header = HEADER.exec(line)
      if (header !== null) {
        current = rowsBySection.find(section => section.line === index + 1)
        return
      }
      if (/^##\s/u.test(line)) current = undefined
      if (current === undefined) return
      const row = /^\|\s*([^|]+?)\s*\|\s*([\d,]+)\s*\|\s*$/u.exec(line)
      if (row !== null && row[1] !== 'File' && row[1].startsWith('-') === false) {
        current.rows.push({ path: row[1], bytes: Number(row[2].replace(/,/gu, '')), line: index + 1 })
        return
      }
      // "| Markdown (...) | 15 | no - served as text |": a count by class, not a byte row.
      const classRow = /^\|\s*([^|]+?)\s*\|\s*(\d+)\b/u.exec(line)
      if (classRow !== null && classRow[1] !== 'Class') {
        current.classRows.push({ label: classRow[1], count: Number(classRow[2]), line: index + 1 })
      }
    })
  }

  /** Tree file counts by extension, for the class tables that count payload by kind. */
  const extensionOf = (path) => path.slice(path.lastIndexOf('.'))
  const problems = []
  for (const section of rowsBySection) {
    const tree = (await walk(join(vendorDir, section.skill))).sort()
    assert.ok(tree.length > 0, section.skill + ' must exist under vendor/')
    assert.equal(section.claimed, tree.length,
      doc + ':' + String(section.line) + ' claims ' + section.skill + '/ has ' + String(section.claimed)
      + ' files; the vendored tree has ' + String(tree.length))
    if (section.rows.length > 0) {
      assert.equal(section.rows.length, section.claimed,
        doc + ':' + String(section.line) + ' claims ' + String(section.claimed) + ' files but lists '
        + String(section.rows.length) + ' rows')
      const listed = section.rows.map(row => row.path).sort()
      const missing = tree.filter(path => listed.includes(path) === false)
      const extra = listed.filter(path => tree.includes(path) === false)
      assert.deepEqual({ missing, extra }, { missing: [], extra: [] },
        doc + ' must list exactly the ' + section.skill + '/ tree: missing ' + missing.join(', ')
        + '; listed but absent ' + extra.join(', '))
      for (const row of section.rows) {
        const actual = (await stat(join(vendorDir, section.skill, row.path))).size
        if (actual !== row.bytes) problems.push(doc + ':' + String(row.line) + ' ' + row.path + ' says '
          + String(row.bytes) + ' bytes, stat() says ' + String(actual))
      }
    }

    // Class tables: "| Markdown (SKILL.md + 14 more) | 15 | no - served as text |" is a count
    // of files by kind, so it is checked against the tree by extension. This is what makes
    // "6 Python scripts" a measurement rather than a sentence.
    const CLASS_OF = [
      { pattern: /Markdown/u, extension: '.md' },
      { pattern: /Python/u, extension: '.py' },
      { pattern: /\.js\b/u, extension: '.js' },
      { pattern: /\.json\b/u, extension: '.json' },
    ]
    let classRows = 0
    for (const row of section.classRows) {
      const mapping = CLASS_OF.find(entry => entry.pattern.test(row.label))
      assert.ok(mapping !== undefined, doc + ':' + String(row.line) + ' class "' + row.label
        + '" is not a kind this test can count; extend CLASS_OF rather than let it go unchecked')
      classRows += 1
      const actual = tree.filter(path => extensionOf(path) === mapping.extension).length
      if (actual !== row.count) problems.push(doc + ':' + String(row.line) + ' ' + row.label + ' says '
        + String(row.count) + ' ' + mapping.extension + ' file(s), the tree holds ' + String(actual))
    }
    if (classRows > 0) {
      const claimedTotal = section.classRows.reduce((total, row) => total + row.count, 0)
      assert.equal(claimedTotal, section.claimed,
        doc + ':' + String(section.line) + ' class rows sum to ' + String(claimedTotal)
        + ' but the header claims ' + String(section.claimed))
    }
  }

  // Every "shared/<path> (N,NNN)" bullet in the shared/ section is a real vendored file with
  // that size; the scripts/ section next to it is advisory and NOT vendored, so it is not
  // measured here and the test does not pretend otherwise.
  let sharedChecked = 0
  lines.forEach((line, index) => {
    const match = /^-\s+(shared\/\S+)\s+\(([\d,]+)\)/u.exec(line)
    if (match === null) return
    sharedChecked += 1
    const bytes = Number(match[2].replace(/,/gu, ''))
    const actual = statSyncSize(join(vendorDir, match[1]))
    if (actual === undefined) problems.push(doc + ':' + String(index + 1) + ' ' + match[1] + ' is listed but not vendored')
    else if (actual !== bytes) problems.push(doc + ':' + String(index + 1) + ' ' + match[1] + ' says '
      + String(bytes) + ' bytes, stat() says ' + String(actual))
  })

  assert.deepEqual(problems, [], 'the inventory disagrees with the tree:\n  ' + problems.join('\n  '))

  const measured = rowsBySection.reduce((total, section) => total + section.rows.length, 0) + sharedChecked

  // The document quotes sizes it cannot prove from this package: the upstream-only scripts
  // are not vendored, so nothing here can stat() them. That is legitimate - but only if the
  // file says so and says how to re-derive them, and only if its own arithmetic holds. The
  // basis paragraph is therefore checked like any other claim: a paragraph that states the
  // method and then miscounts the rows it covers is worse than no paragraph, because it is
  // the thing a future editor will trust instead of measuring.
  let basisStart = -1
  lines.forEach((line, index) => {
    if (basisStart === -1 && /\*\*What the numbers in this file are/u.test(line)) basisStart = index
  })
  assert.notEqual(basisStart, -1,
    doc + ' must state what its numbers ARE (the basis paragraph); a table of byte sizes with no stated'
    + ' basis is how the previous edition drifted by one byte per line')

  const basis = []
  for (let index = basisStart; index < lines.length; index += 1) {
    if (lines[index].trim() === '') break
    basis.push(lines[index])
  }
  const stated = basis.join(' ').replace(/\s+/gu, ' ')
  assert.match(stated, /repository byte count/u,
    doc + ' basis must say the numbers are repository bytes, not worktree bytes')
  assert.match(stated, /git cat-file -s/u,
    doc + ' basis must give the re-derivation (git cat-file -s <commit>:<path>) so a reader without the'
    + ' vendored file can check a row')
  assert.match(stated, /core\.autocrlf/u,
    doc + ' basis must name the failure mode that produced the stale edition, not only the unit')

  const counted = /(\d+) rows[^.]*?the (\d+) vendored files[^.]*?the (\d+) upstream-only scripts/u.exec(stated)
  assert.notEqual(counted, null,
    doc + ' basis must count the rows it covers (N rows, the V vendored files and the S upstream-only scripts)'
    + ' so the split between measured and documented is checkable')

  const statedTotal = Number(counted[1])
  const statedVendored = Number(counted[2])
  const statedScripts = Number(counted[3])
  const scriptSizes = []
  lines.forEach((line) => {
    for (const match of line.matchAll(/\b([a-z0-9_]+\.py)\s+\(([\d,]+)\)/gu)) {
      scriptSizes.push({ name: match[1], bytes: Number(match[2].replace(/,/gu, '')) })
    }
  })

  assert.equal(statedVendored, measured,
    doc + ' basis says it covers ' + String(statedVendored) + ' vendored files, but this file holds '
    + String(measured) + ' measured row(s) ('
    + String(rowsBySection.reduce((total, section) => total + section.rows.length, 0)) + ' table + '
    + String(sharedChecked) + ' shared/)')
  assert.equal(statedScripts, scriptSizes.length,
    doc + ' basis says ' + String(statedScripts) + ' upstream-only scripts, but the file quotes '
    + String(scriptSizes.length) + ' script size(s)')
  assert.equal(statedTotal, statedVendored + statedScripts,
    doc + ' basis says ' + String(statedTotal) + ' rows but splits them into '
    + String(statedVendored) + ' + ' + String(statedScripts))

  // The reach is printed, not implied. Fourteen rows in this file are quoted from the object
  // store and cannot be stat()ed from this package; a pass line that let a reader believe
  // otherwise would be the same defect as a stale pin, one layer out.
  console.log('# inventory: ' + String(rowsBySection.length) + ' claimed tree(s) recount to their rows and their trees; '
    + String(measured) + ' of ' + String(statedTotal) + ' byte rows measured here ('
    + String(rowsBySection.reduce((total, section) => total + section.rows.length, 0)) + ' table + '
    + String(sharedChecked) + ' shared/) match stat(); the ' + String(statedScripts)
    + ' upstream-only script sizes are documented from the object store and are NOT measured by this suite')
})

/** stat().size, or undefined when the path is not there - used inside a forEach. */
function statSyncSize(path) {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}

/**
 * The upstream-only script sizes: measured, or named as not measured.
 *
 * docs/UPSTREAM_INVENTORY.md quotes fourteen sizes for scripts this package does NOT vendor.
 * They cannot be stat()ed here, so the release invariant has to reach them another way: the
 * pinned commit's object store. The risk of an environment-gated check is that it passes by
 * doing nothing, on every machine that lacks the clone, forever - a comment with a skip line
 * attached. So the mechanism is proved FIRST, unconditionally, against a throwaway repository
 * built in the test: same measurement, same comparison, one size nudged, the failure required
 * to name the file and both values. Only then does DSH_UPSTREAM_CLONE supply real data, and
 * when it is absent the test names every path it could not verify instead of saying "skipped".
 *
 * No machine-local path is written into this repository: the variable carries the path at run
 * time, and the documents name the variable and the commit, never a directory.
 */

const execFileAsync = promisify(execFile)

/** Run git and return stdout, trimmed. Throws with the command in the message if it fails. */
async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
    return stdout.trim()
  } catch (error) {
    throw new Error('git ' + args.join(' ') + ' failed in ' + cwd + ': ' + (error.message ?? String(error)))
  }
}

/** The script sizes the inventory quotes, in document order. */
function scriptRows(documentLines) {
  const rows = []
  documentLines.forEach((line, index) => {
    for (const match of line.matchAll(/\b([a-z0-9_]+\.py)\s+\(([\d,]+)\)/gu)) {
      rows.push({ name: match[1], path: 'scripts/' + match[1], bytes: Number(match[2].replace(/,/gu, '')), line: index + 1 })
    }
  })
  return rows
}

/** Read sizes out of the object store at a commit: repository bytes, never worktree bytes. */
async function measureScripts(clonePath, commit, paths) {
  const measured = []
  for (const path of paths) {
    const size = await git(['cat-file', '-s', commit + ':' + path], clonePath)
    measured.push({ path, bytes: Number(size) })
  }
  return measured
}

/** Compare a document's claims against measurements, in both directions. */
function compareScriptSizes(stated, measured) {
  const problems = []
  const byPath = new Map(measured.map(entry => [entry.path, entry.bytes]))
  for (const row of stated) {
    const actual = byPath.get(row.path)
    if (actual === undefined) {
      problems.push(row.path + ' is quoted in the document (line ' + String(row.line) + ') but was not measured')
      continue
    }
    if (actual !== row.bytes) {
      problems.push(row.path + ' is documented as ' + String(row.bytes) + ' bytes, the object store says ' + String(actual))
    }
  }
  for (const entry of measured) {
    if (stated.some(row => row.path === entry.path) === false) {
      problems.push(entry.path + ' was measured but is not quoted in the document')
    }
  }
  return problems
}

test('the upstream script check is a mechanism that can fail (throwaway repository)', async () => {
  const stated = scriptRows(await linesOf(join('docs', 'UPSTREAM_INVENTORY.md')))
  assert.ok(stated.length > 0, 'the inventory must quote upstream-only script sizes to check at all')

  const dir = await mkdtemp(join(tmpdir(), 'dsh-upstream-fixture-'))
  try {
    await git(['init', '-q'], dir)
    await mkdir(join(dir, 'scripts'), { recursive: true })
    const contents = stated.map(row => 'fixture content for ' + row.name + '\n' + 'x'.repeat(row.name.length) + '\n')
    for (const [index, row] of stated.entries()) await writeFile(join(dir, row.path), contents[index], 'utf8')
    await git(['add', 'scripts'], dir)
    await git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture',
      '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'], dir)
    const commit = await git(['rev-parse', 'HEAD'], dir)

    const measured = await measureScripts(dir, commit, stated.map(row => row.path))
    assert.equal(measured.length, stated.length, 'every quoted path must be measured, not a subset')
    for (const [index, entry] of measured.entries()) {
      assert.equal(entry.bytes, Buffer.byteLength(contents[index], 'utf8'),
        entry.path + ' must be measured as repository bytes (' + String(Buffer.byteLength(contents[index], 'utf8'))
        + '), not as something else (' + String(entry.bytes) + ')')
    }

    // The honest table produces no complaints: if this could not be zero, every run would be
    // noise and the real check would be unreadable.
    assert.deepEqual(compareScriptSizes(stated.map(row => ({ ...row, bytes: 0 })).map((row, index) => ({ ...row, bytes: measured[index].bytes })), measured), [],
      'a table that agrees with the measurements must produce no problems')

    // One nudged byte must produce exactly one problem, naming the file AND both values.
    const nudged = stated.map((row, index) => ({ ...row, bytes: index === 3 ? measured[index].bytes + 1 : measured[index].bytes }))
    const problems = compareScriptSizes(nudged, measured)
    assert.equal(problems.length, 1, 'one wrong row must produce one problem, saw ' + String(problems.length))
    assert.match(problems[0], new RegExp(stated[3].name.replace(/\./gu, '\\.')),
      'the failure must name the file: ' + problems[0])
    assert.match(problems[0], new RegExp(String(measured[3].bytes + 1) + ' bytes, the object store says ' + String(measured[3].bytes)),
      'the failure must name both values: ' + problems[0])
    console.log('# upstream script fixture: ' + String(measured.length) + ' files of known content in a throwaway repository; '
      + 'one nudged byte produced exactly one problem naming the file and both values')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the upstream-only script sizes match the pinned object store, or are named as unverified', async () => {
  const stated = scriptRows(await linesOf(join('docs', 'UPSTREAM_INVENTORY.md')))
  assert.ok(stated.length > 0, 'the inventory must quote upstream-only script sizes')
  assert.equal(new Set(stated.map(row => row.name)).size, stated.length,
    'each upstream-only script must be quoted once: ' + stated.map(row => row.name).join(', '))

  const clone = process.env.DSH_UPSTREAM_CLONE
  if (clone === undefined || clone === '') {
    // Not a silent skip. Every path is named, because a single "skipped" line is how a check
    // stops being read. The mechanism itself was exercised by the test above on every run.
    for (const row of stated) {
      console.log('#   not verified: ' + row.path + ' (' + String(row.bytes) + ' bytes, inventory line '
        + String(row.line) + ') - no DSH_UPSTREAM_CLONE')
    }
    console.log('# upstream script sizes: ' + String(stated.length) + ' NOT verified (DSH_UPSTREAM_CLONE unset);'
      + ' the mechanism is proved against a fixture repository above, on every run')
    return
  }

  const { upstream } = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const measured = await measureScripts(clone, upstream.commit, stated.map(row => row.path))
  assert.equal(measured.length, stated.length,
    'the clone must yield a measurement for every quoted script, not a subset: '
    + String(measured.length) + ' of ' + String(stated.length))
  const problems = compareScriptSizes(stated, measured)
  assert.deepEqual(problems, [],
    'the inventory and the object store disagree at ' + upstream.commit + ':\n  ' + problems.join('\n  '))
  console.log('# upstream script sizes: ' + String(stated.length) + ' verified against ' + upstream.commit.slice(0, 12)
    + ' in DSH_UPSTREAM_CLONE')
})
