const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
let server, base, dir, requests = []
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topify-cli-test-'))
  fs.writeFileSync(path.join(dir, 'cookie'), 'session=cn-test')
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, method: req.method, headers: req.headers })
    res.setHeader('Content-Type', 'application/json')
    if (req.url.includes('/stall-body')) { res.write('{'); return }
    if (req.url.includes('/stall')) return
    if (req.url.includes('/empty')) { res.statusCode = 204; return res.end() }
    if (req.url.includes('/denied')) { res.statusCode = 403; return res.end('{"detail":"forbidden"}') }
    if (req.url.includes('/redirect')) { res.statusCode = 302; res.setHeader('Location', '/leak'); return res.end() }
    if (/\/projects\/[^/]+\/report\?/.test(req.url)) { res.setHeader('Content-Type','text/html'); return res.end('<html>customer report</html>') }
    if (req.url.startsWith('/api/customer/')) return res.end(JSON.stringify({ items: [{ id: 'cn-company' }], received: req.url }))
    if (req.url.includes('/topics')) return res.end(JSON.stringify({ data: [{ topic_id: 'topic-1', name: 'Topic', description: 'Context' }] }))
    res.end(JSON.stringify({ data: { project_id: 'project-1', total: 2, prompts: [
      { prompt_id: 'p1', topic_id: 'topic-1', content: 'first prompt' },
      { prompt_id: 'p2', topic_id: 'topic-2', content: 'second prompt' }
    ] } }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  process.env.TOPIFY_API_BASE = `${base}/api/public/v1`
})
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }) })
function cli(args, extra = {}) {
  return new Promise(resolve => {
    const proc = spawn(process.execPath, [path.join(__dirname, '../bin/topify.js'), ...args], { env: {
      ...process.env, TOPIFY_API_BASE: `${base}/api/public/v1`, TOPIFY_API_KEY: 'overseas-test',
      TOPIFY_CN_BASE: base, TOPIFY_CN_COOKIE_FILE: path.join(dir, 'cookie'), TOPIFY_CONFIG_DIR: dir, ...extra
    } })
    let stdout = '', stderr = ''
    proc.stdout.on('data', x => { stdout += x }); proc.stderr.on('data', x => { stderr += x })
    proc.on('exit', code => resolve({ code, stdout, stderr }))
  })
}
test('real CLI renders current backend prompt envelope', async () => {
  const r = await cli(['prompts', 'list', '--project', 'project-1'])
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /first prompt/); assert.match(r.stdout, /second prompt/)
})
test('JSON topic filter and analytics filters use backend contract', async () => {
  const r = await cli(['prompts', 'list', '--project', 'project-1', '--topic-id', 'topic-1', '--days', '30', '--providers', 'gemini', '--json'])
  assert.equal(r.code, 0, r.stderr); const data = JSON.parse(r.stdout)
  assert.equal(data.total, 1); assert.equal(data.prompts[0].prompt_id, 'p1')
  assert.match(requests.at(-1).url, /duration_days=30/); assert.match(requests.at(-1).url, /providers=gemini/)
})
test('topics shows identity and does not invent zero counts', async () => {
  const r = await cli(['topics', '--project', 'project-1'])
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /topic-1/); assert.doesNotMatch(r.stdout, /0 prompts/)
})
test('domestic uses only session, correct path, repeated provider filters', async () => {
  const r = await cli(['domestic', 'responses', '--company', 'cn-company', '--provider', 'doubao', '--provider', 'kimi', '--from', '2026-10-01'])
  assert.equal(r.code, 0, r.stderr); JSON.parse(r.stdout)
  const q = requests.at(-1); assert.equal(q.method, 'GET'); assert.equal(q.headers.cookie, 'session=cn-test'); assert.equal(q.headers['x-api-key'], undefined)
  assert.match(q.url, /^\/api\/customer\/companies\/cn-company\/responses\?/); assert.match(q.url, /provider=doubao&provider=kimi/)
})
test('overseas never receives domestic cookie', async () => {
  await cli(['topics', '--project', 'project-1', '--json']); const q = requests.at(-1)
  assert.equal(q.headers['x-api-key'], 'overseas-test'); assert.equal(q.headers.cookie, undefined)
})
test('domestic refuses missing credentials, arbitrary paths and multiple prompt providers', async () => {
  const { DomesticAPI } = require('../src/domestic')
  assert.throws(() => new DomesticAPI({ base, cookie: '' }), /Cookie/)
  const api = new DomesticAPI({ base, cookie: 'session=test' })
  await assert.rejects(api.read('delete'), /Unsupported/)
  await assert.rejects(api.read('overview', { company: '../other' }), /company/)
  await assert.rejects(api.read('prompts', { company: 'c', provider: ['doubao', 'kimi'] }), /one --provider/)
})
test('request and response-body deadlines abort without duplicate mutation', async () => {
  const { TopifyAPI } = require('../src/api')
  const api = new TopifyAPI('test', { timeoutMs: 40 })
  for (const target of ['/stall', '/stall-body']) {
    const before = requests.length
    await assert.rejects(api.mutate('POST', target, { value: 1 }), /timed out/)
    assert.equal(requests.length - before, 1)
  }
  assert.equal(await api.mutate('DELETE', '/empty'), null)
  await assert.rejects(api.request('/denied'), /forbidden/)
  const before = requests.length
  await assert.rejects(api.request('/redirect'))
  assert.equal(requests.length - before, 1)
})

test('legacy pagination remains usable and exports retain full prompt text', async () => {
  const paged = await cli(['prompts', 'list', '--project', 'project-1', '--page', '2', '--page-size', '1', '--json'])
  assert.equal(paged.code, 0, paged.stderr)
  assert.equal(JSON.parse(paged.stdout).prompts[0].prompt_id, 'p2')
  const file = path.join(dir, 'export.json')
  const exported = await cli(['export', 'topics', '--project', 'project-1', '--output', file])
  assert.equal(exported.code, 0, exported.stderr)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(data[0].prompts[0].content, 'first prompt')
  const repeated = await cli(['export', 'topics', '--project', 'project-1', '--output', file])
  assert.equal(repeated.code, 1)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data)
})

test('visibility and source analytics use actual public API routes', async () => {
  const { TopifyAPI } = require('../src/api')
  const api = new TopifyAPI('test')
  await api.getVisibilityTrends('project-1')
  assert.equal(requests.at(-1).url, '/api/public/v1/projects/project-1/visibility')
  await api.getSourcesAnalytics('project-1')
  assert.equal(requests.at(-1).url, '/api/public/v1/projects/project-1/sources/analytics')
})

test('all added customer read resources use explicit authorized paths', async () => {
  const { RESOURCES, readPath } = require('../src/data')
  for (const resource of RESOURCES) {
    const opts = { id: 'record-1', domain: 'example.com', name: 'draft.md' }
    const expected = readPath(resource, 'project-1', opts)
    const r = await cli(['data', resource, '--project', 'project-1', '--id', opts.id, '--domain', opts.domain, '--name', opts.name, '--days', '7', '--providers', 'gemini'])
    assert.equal(r.code, 0, `${resource}: ${r.stderr}`)
    assert.equal(new URL(requests.at(-1).url, base).pathname, '/api/public/v1' + expected)
    assert.equal(requests.at(-1).headers.cookie, undefined)
    assert.equal(requests.at(-1).method, 'GET')
  }
  const before = requests.length
  assert.notEqual((await cli(['data', 'admin', '--project', 'project-1'])).code, 0)
  assert.notEqual((await cli(['data', 'prompt-chats', '--project', 'project-1', '--id', 'p'])).code, 0)
  assert.equal(requests.length, before)
})

test('domestic detail and accuracy filters preserve auth and reject path traversal', async () => {
  for (const [resource, id, suffix] of [['prompt-detail', 'abcdef:1', '/prompts/abcdef%3A1'], ['response-detail', 'response-1', '/responses/response-1']]) {
    const r = await cli(['domestic', resource, '--company', 'c', '--id', id])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(requests.at(-1).url, '/api/customer/companies/c' + suffix)
  }
  const r = await cli(['domestic', 'accuracy-details', '--company', 'c', '--verdict', 'error', '--prompt', '产品', '--offset', '20', '--limit', '10'])
  assert.equal(r.code, 0, r.stderr)
  const q = new URL(requests.at(-1).url, base)
  assert.equal(q.searchParams.get('verdict'), 'error')
  assert.equal(q.searchParams.get('prompt'), '产品')
  assert.equal(q.searchParams.get('offset'), '20')
  const before = requests.length
  assert.notEqual((await cli(['domestic', 'response-detail', '--company', 'c', '--id', '../admin'])).code, 0)
  assert.equal(requests.length, before)
})

test('dashboard read manifest preserves actual methods and never sends API keys', async () => {
  const { WebDataAPI, resources } = require('../src/web-data')
  const api = new WebDataAPI({ base, cookie:'session=web-test' })
  for (const [resource, spec] of Object.entries(resources)) {
    await api.read(resource, spec.query_fields ? {project:'project-1',id:'record-1'} : { project:'project-1', id:'record-1', domain:'example.com', competitor:'competitor-1', days:'7', providers:'gemini,openai' }, Object.fromEntries((spec.required_filters || []).map(k=>[k,'fixture'])))
    const req = requests.at(-1)
    assert.equal(req.method, spec.method)
    assert.equal(req.headers.cookie, 'session=web-test')
    assert.equal(req.headers['x-api-key'], undefined)
    assert.equal(new URL(req.url,base).pathname, spec.path.replace('{project}','project-1').replace('{id}','record-1').replace('{domain}','example.com'))
    const source = path.join(__dirname, '../../topifyai-platform-V2', spec.source)
    if (fs.existsSync(source)) assert.match(fs.readFileSync(source,'utf8'), new RegExp(`export\\s+async\\s+function\\s+${spec.method}`))
  }
  const before = requests.length
  await assert.rejects(api.read('api-keys', {project:'project-1'}), /Unknown/)
  await assert.rejects(api.read('seo-overview', {project:'project-1'}, {user_id:'another-user'}), /identity/)
  await assert.rejects(api.read('seo-overview', {project:'project-1'}, {project_id:'another-project'}), /identity/)
  await assert.rejects(api.read('prompt-outputs', {project:'project-1',id:'..'}), /required/)
  assert.equal(requests.length, before)
  const result = await cli(['web-data','competitors-detail-summary','--project','project-1','--competitor','competitor-1','--days','7'], { TOPIFY_WEB_BASE:base, TOPIFY_WEB_COOKIE_FILE:path.join(dir,'cookie') })
  assert.equal(result.code, 0, result.stderr)
})

test('HTML report download is atomic and does not replace existing files', async () => {
  const { saveRaw } = require('../src/data')
  const target = path.join(dir,'report.html')
  saveRaw(Buffer.from('<html>original</html>'), target, false)
  assert.throws(() => saveRaw(Buffer.from('replacement'), target, false), /EEXIST/)
  assert.equal(fs.readFileSync(target,'utf8'), '<html>original</html>')
  saveRaw(Buffer.from('<html>new</html>'), target, true)
  assert.equal(fs.readFileSync(target,'utf8'), '<html>new</html>')
  assert.equal(fs.statSync(target).mode & 0o777, 0o600)
})

test('real CLI report command downloads HTML and page session rejects redirects and denied scope', async () => {
  const target = path.join(dir,'download.html')
  const result = await cli(['report','--project','project-1','--days','7','-o',target])
  assert.equal(result.code,0,result.stderr)
  assert.equal(fs.readFileSync(target,'utf8'),'<html>customer report</html>')
  assert.equal(requests.at(-1).headers.cookie,undefined)
  const { WebDataAPI } = require('../src/web-data')
  const api = new WebDataAPI({base,cookie:'session=web-test'})
  await assert.rejects(api.read('seo-overview',{project:'denied'}), /403/)
  const before = requests.length
  await assert.rejects(api.read('seo-overview',{project:'redirect'}), /expired/)
  assert.equal(requests.length,before+1)
})


test('project listing directly uses deployed trailing-slash route',async()=>{
  const {TopifyAPI}=require('../src/api')
  await new TopifyAPI('test').listProjects()
  assert.equal(requests.at(-1).url,'/api/public/v1/projects/')
  const r=await cli(['data','projects'])
  assert.equal(r.code,0,r.stderr);assert.equal(requests.at(-1).url,'/api/public/v1/projects/')
})

test('answer batch commands use only the public API key and preserve pagination filters',async()=>{
  const r=await cli(['data','outputs','--project','project-1','--prompt-ids','p1,p2','--days','7','--offset','50','--limit','25'])
  assert.equal(r.code,0,r.stderr)
  const q=requests.at(-1), u=new URL(q.url,base)
  assert.equal(u.pathname,'/api/public/v1/projects/project-1/outputs')
  assert.equal(u.searchParams.get('prompt_ids'),'p1,p2');assert.equal(u.searchParams.get('offset'),'50');assert.equal(u.searchParams.get('limit'),'25')
  assert.equal(q.headers['x-api-key'],'overseas-test');assert.equal(q.headers.cookie,undefined)
})
