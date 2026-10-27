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
 * @module dsh-academic-review/tests/release-invariants
 */

import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
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
  const INSTALL = /dsh\s+plugin\b.*\badd\b\s+(\S+)/u

  const perDoc = {}
  for (const doc of ['README.md', 'README.zh-CN.md']) {
    const lines = await linesOf(doc)
    const tracker = sectionTracker()
    const installLines = []
    lines.forEach((line, index) => {
      const heading = tracker.feed(line)
      const match = INSTALL.exec(line)
      if (match === null) return
      // History sections quote the release they describe; the current install lines do not.
      if (isHistoryHeading(heading)) return
      const target = match[1]
      const tags = [...target.matchAll(/#v(\d+\.\d+\.\d+)|-(\d+\.\d+\.\d+)\.(?:tgz|tar\.gz)/gu)]
        .map(found => found[1] ?? found[2])
      installLines.push({ line: index + 1, target, tags })
    })
    assert.ok(installLines.length > 0, doc + ' must contain at least one install line; none was found')

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

  const headings = []
  lines.forEach((line, index) => {
    const match = /^##\s+\[([^\]]+)\]\s*(.*)$/u.exec(line)
    if (match !== null) headings.push({ line: index + 1, version: match[1], rest: match[2].trim() })
  })
  assert.ok(headings.length > 0, 'CHANGELOG.md must have at least one "## [x.y.z]" section')

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

  // The first section must also be the highest version, so a 0.5.0 entry inserted below a
  // 0.4.0 one cannot leave the file claiming the older release is current.
  const numeric = headings
    .filter(heading => VERSION.test(heading.version))
    .map(heading => ({ version: heading.version.split('.').map(Number), line: heading.line, text: heading.version }))
  const highest = numeric.reduce((best, heading) => {
    for (let index = 0; index < 3; index += 1) {
      if (heading.version[index] !== best.version[index]) return heading.version[index] > best.version[index] ? heading : best
    }
    return best
  })
  assert.equal(highest.text, version, 'the highest section in CHANGELOG.md must be the shipped version')
  console.log('# changelog: newest section [' + newest.version + '] ' + newest.rest + ' at line ' + String(newest.line)
    + '; ' + String(headings.length) + ' sections, highest ' + highest.text)
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

  // A commit is written as lowercase hex that uses at least one letter: a token of nothing
  // but digits is a date wearing hex clothes (a review_id example reads rev-20261027-<8hex>),
  // and no test should call a date a stale pin.
  const COMMIT_SHAPED = /\b[0-9a-f]{7,40}\b/gu
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
      for (const match of line.matchAll(COMMIT_SHAPED)) {
        const token = match[0]
        if (/^[0-9]+$/u.test(token)) {
          skipped += 1
          continue
        }
        checked += 1
        if (pinned.startsWith(token)) {
          if (token in NON_UPSTREAM_COMMITS) used.add(token)
          continue
        }
        if (token in NON_UPSTREAM_COMMITS) {
          used.add(token)
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
  console.log('# commit pins: ' + String(checked) + ' commit-shaped token(s) checked against ' + pinned.slice(0, 12)
    + ', ' + String(skipped) + ' date-shaped token(s) skipped, ' + String(used.size) + ' allowlisted as this repo\'s own')
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
  console.log('# inventory: ' + String(rowsBySection.length) + ' claimed tree(s) recount to their rows and their trees, '
    + String(rowsBySection.reduce((total, section) => total + section.rows.length, 0)) + ' byte row(s) and '
    + String(sharedChecked) + ' shared/ size(s) match stat()')
})

/** stat().size, or undefined when the path is not there - used inside a forEach. */
function statSyncSize(path) {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}
