const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), os = require('os'), path = require('path')
const { csv, saveExport, allDomestic, allSources } = require('../src/export')
test('CSV preserves quotes/newlines and disables string formula cells; atomic output never clobbers by default', () => {
  assert.match(csv([{ title: '=IMPORTXML("url")', body: 'a\nb', n: 0 }]), /'\=IMPORTXML/)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topify-export-')), target = path.join(dir, 'data.json')
  try {
    saveExport({ real: 0 }, { output: target })
    assert.throws(() => saveExport({ changed: true }, { output: target }), /EEXIST/)
    assert.deepEqual(JSON.parse(fs.readFileSync(target)), { real: 0 })
    assert.equal(fs.readdirSync(dir).length, 1)
  } finally { fs.rmSync(dir, { recursive: true }) }
})
test('domestic cursor/offset pagination fetches all and rejects changed revisions', async () => {
  const read = async (resource, opts) => ({ snapshot_id: 's', revision: 1, source_updated_at: 'fixed', items: [{ id: opts.cursor || 'first' }], next_cursor: opts.cursor ? null : 'next' })
  assert.equal((await allDomestic({ read }, 'responses', {})).items.length, 2)
  let n = 0
  await assert.rejects(allDomestic({ read: async () => ({ snapshot_id: 's', revision: ++n, items: [1], next_cursor: 'next' }) }, 'prompts', {}), /Data changed/)
  await assert.rejects(allDomestic({ read: async () => ({ items: [1], next_cursor: 'same' }) }, 'prompts', {}), /did not advance/)
  const sources = await allDomestic({ read: async (_, opts) => ({ snapshot_id: 's', revision: 1, items: [{ domain: String(opts.offset) }], next_offset: opts.offset ? null : 100 }) }, 'sources', {})
  assert.equal(sources.items.length, 2)
})
test('overseas sources export handles multiple pages and detects ignored pagination', async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ source_id: String(i) }))
  const client = { getSources: async (_, opts) => ({ data: opts.page === 1 ? first : [{ source_id: 'last' }] }) }
  assert.equal((await allSources(client, 'p', {})).length, 101)
  await assert.rejects(allSources({ getSources: async () => ({ data: first }) }, 'p', {}), /repeated/)
})
