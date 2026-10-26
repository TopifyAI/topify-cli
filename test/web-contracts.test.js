const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { WebDataAPI } = require('../src/web-data')

test('page-specific filters reach the server in the required structure', async t => {
  const requests = []
  const server = http.createServer(async (req,res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ url:new URL(req.url,'http://localhost'), body:body ? JSON.parse(body):null })
    res.setHeader('Content-Type','application/json'); res.end('{"code":200,"data":[]}')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const api = new WebDataAPI({base:`http://127.0.0.1:${server.address().port}`,cookie:'test=session'})
  await api.read('sources-detail-urls',{project:'p',domain:'example.com',from:'2026-10-19',to:'2026-10-25',providers:'gemini,openai',page:'2',pageSize:'20'})
  assert.deepEqual(requests.at(-1).body,{project_id:'p',domain:'example.com',date_range:{start:'2026-10-19',end:'2026-10-25'},filters:{models:['gemini','openai']},pagination:{page:2,page_size:20}})
  await api.read('competitors-detail-summary',{project:'p',competitor:'c',days:'0'})
  assert.deepEqual(requests.at(-1).body,{project_id:'p',competitor_id:'c',date_range:{duration_days:0}})
  await api.read('sources-list',{project:'p',from:'2026-10-19',to:'2026-10-25',providers:'gemini'})
  const q=requests.at(-1).url.searchParams
  assert.equal(q.get('start'),'2026-10-19');assert.equal(q.get('end'),'2026-10-25');assert.equal(q.get('models'),'gemini');assert.equal(q.has('providers'),false)
  await api.read('prompt-list',{project:'p',days:'30'})
  assert.equal(requests.at(-1).url.searchParams.get('ord'),'desc')
  assert.equal(requests.at(-1).url.searchParams.get('range'),'30')
  assert.equal(requests.at(-1).url.searchParams.get('lightweight'),'true')
  const before=requests.length
  for(const opts of [{days:'NaN'},{days:'-1'},{page:'0'},{from:'2026-02-30',to:'2026-03-01'},{from:'2026-01-01'}]) {
    await assert.rejects(api.read('overview-visibility',{project:'p',...opts}))
  }
  assert.equal(requests.length,before)
})
test('application error envelope cannot be exported as successful data', async t=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"code":403,"message":"denied"}')})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const api=new WebDataAPI({base:`http://127.0.0.1:${server.address().port}`,cookie:'test=session'})
  await assert.rejects(api.read('overview-settings',{project:'p'}),/application error 403/)
})

test('tabular exports require an existing array and never silently drop data',()=>{
  const {selectRows}=require('../src/web-data')
  const data={data:{domain_table:{total:2,items:[{domain:'example.com',citation_count:3}]}}}
  assert.equal(selectRows(data),data)
  assert.deepEqual(selectRows(data,'data.domain_table.items'),[{domain:'example.com',citation_count:3}])
  assert.throws(()=>selectRows(data,'data.missing'),/no rows/)
  assert.throws(()=>selectRows(data,'data.domain_table'),/not an array/)
  assert.throws(()=>selectRows(data,'__proto__.items'),/no rows/)
})

test('history population is not a read capability',async()=>{
  const api=new WebDataAPI({cookie:'test=session'})
  await assert.rejects(api.read('competitors-metrics-history',{project:'p'}),/Unknown/)
  await assert.rejects(api.read('prompts-fanouts-prompts',{project:'p'}),/fanout_query/)
})

test('real CLI supports discoverable batch options and refuses misleading disconnected exports',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process')
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'web-usability-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.writeFileSync(path.join(dir,'cookie'),'test=session')
  const requests=[]
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk
    requests.push({url:req.url,body:body?JSON.parse(body):null})
    res.setHeader('Content-Type','application/json')
    if (req.url.includes('/overview/sources')) { res.statusCode=504; res.end('{}'); return }
    res.end(req.url.includes('/gsc/')?' {"connected":false,"rows":[]}':'{"code":200,"data":{"items":[{"full_answer":"complete answer"}],"has_more":false}}')
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
  const run=args=>new Promise(resolve=>{
    const p=spawn(process.execPath,[path.join(__dirname,'../bin/topify.js'),...args],{env:{...process.env,TOPIFY_WEB_COOKIE_FILE:path.join(dir,'cookie'),TOPIFY_WEB_BASE:`http://127.0.0.1:${server.address().port}`}})
    let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('exit',code=>resolve({code,out,err}))
  })
  let r=await run(['web-resources','prompt-answers-export']);assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).filter_options.promptIds,'prompt_ids');assert.equal(requests.length,0)
  r=await run(['web-data','prompt-answers-export','--project','p','--prompt-ids','p1,p2','--offset','5','--limit','10','--days','7','--rows','data.items'])
  assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out)[0].full_answer,'complete answer')
  assert.deepEqual(requests.at(-1).body,{project_id:'p',prompt_ids:['p1','p2'],offset:5,limit:10,duration_days:7})
  const target=path.join(dir,'gsc.csv')
  r=await run(['web-data','seo-gsc-queries','--project','p','--rows','rows','--format','csv','-o',target]);assert.equal(r.code,1);assert.match(r.err,/not connected/);assert.equal(fs.existsSync(target),false)
  const failedTarget=path.join(dir,'failed.json'), count=requests.length
  r=await run(['web-data','overview-sources','--project','p','--days','7','-o',failedTarget]);assert.equal(r.code,1);assert.match(r.err,/sources-list/);assert.equal(requests.length,count+1);assert.equal(fs.existsSync(failedTarget),false)
  const before=requests.length
  r=await run(['web-data','sources-list','--project','p','--prompt-ids','p1']);assert.equal(r.code,1);assert.equal(requests.length,before)
  r=await run(['web-data','sources-list','--project','p','--timeout','NaN']);assert.equal(r.code,1);assert.equal(requests.length,before)
})
test('convenience options cannot silently replace conflicting filters',async()=>{
 const api=new WebDataAPI({cookie:'test=session'})
 await assert.rejects(api.read('prompt-answers-export',{project:'p',limit:'10'},{limit:20}),/Conflicting limit/)
 await assert.rejects(api.read('prompt-answers-export',{project:'p',offset:'-1'}),/invalid/)
 await assert.rejects(api.read('prompt-answers-export',{project:'p',promptIds:','}),/valid/)
})
