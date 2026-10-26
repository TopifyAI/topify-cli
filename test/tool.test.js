const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ToolAPI, RESOURCES } = require('../src/tool')

test('tool HTTP contract, credentials isolated, failures never use legacy endpoints', async t => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req)
    res.setHeader('Content-Type', 'application/json')
    if (req.url.includes('redirect')) { res.statusCode=302; res.setHeader('Location','/leak'); return res.end() }
    if (req.url.includes('denied')) { res.statusCode=403; return res.end('{"secret":"must not print"}') }
    if (req.url.includes('missing')) { res.statusCode=404; return res.end('{}') }
    res.end(JSON.stringify({reports:[{id:'r1',brand_name:'Sample'}],total:1,page:1,total_pages:1}))
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base=`http://127.0.0.1:${server.address().port}`
  const api=new ToolAPI({base,invitation:'owned-test-code'})
  for (const resource of RESOURCES) await api.read(resource,{id:'r1',promptIndex:0})
  assert.equal(seen.length,RESOURCES.length)
  for (const req of seen) {
    assert.equal(req.method,'GET'); assert.match(req.url,/^\/api\/employee\/reports\//)
    assert.equal(req.headers['x-invitation-code'],'owned-test-code')
    assert.equal(req.headers.cookie,undefined); assert.equal(req.headers['x-api-key'],undefined); assert.equal(req.headers['x-admin-token'],undefined)
    assert.doesNotMatch(req.url,/owned-test-code/)
  }
  for(const id of ['redirect','denied','missing']) await assert.rejects(api.read('summary',{id}))
  assert.equal(seen.length,RESOURCES.length+3)
  await assert.rejects(api.read('summary',{id:'../private'}))
  await assert.rejects(api.read('responses',{id:'r1',promptIndex:-1}))
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tool-cli-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.writeFileSync(path.join(dir,'credential'),'owned-test-code',{mode:0o600})
  const output=await new Promise(resolve=>{
    const child=spawn(process.execPath,[path.join(__dirname,'../bin/topify.js'),'tool','history','--all'],{env:{...process.env,TOPIFY_TOOL_BASE:base,TOPIFY_TOOL_INVITATION_FILE:path.join(dir,'credential'),TOPIFY_CN_COOKIE_FILE:'/not-used',TOPIFY_API_KEY:'not-used',TOPIFY_CONFIG_DIR:dir}})
    let stdout='',stderr=''; child.stdout.on('data',s=>stdout+=s); child.stderr.on('data',s=>stderr+=s)
    child.on('exit',code=>resolve({code,stdout,stderr}))
  })
  assert.equal(output.code,0,output.stderr); assert.equal(JSON.parse(output.stdout).exported_count,1)
})

test('all pages fail closed on drift, repeated rows and missing totals', async () => {
  const api=new ToolAPI({invitation:'test'})
  api.read=async (_,opts)=>({reports:[{id:`r${opts.page}`}],total:2,total_pages:2,page:opts.page})
  assert.equal((await api.historyAll()).exported_count,2)
  api.read=async (_,opts)=>({reports:[{id:'same'}],total:2,total_pages:2,page:opts.page})
  await assert.rejects(api.historyAll(),/repeated/)
  api.read=async (_,opts)=>({reports:[{id:`r${opts.page}`}],total:opts.page===1?2:3,total_pages:2,page:opts.page})
  await assert.rejects(api.historyAll(),/changed/)
  api.read=async()=>({reports:[]})
  await assert.rejects(api.historyAll(),/Invalid/)
  await assert.rejects(api.historyAll({page:2}),/omit/)
  assert.throws(()=>new ToolAPI({base:'https://example.test/path',invitation:'test'}),/origin/)
  assert.throws(()=>new ToolAPI({base:'http://example.test',invitation:'test'}),/HTTPS/)
})
