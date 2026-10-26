const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
for (const { RedditAPI } of [require('../src/reddit'), require('../skills/topify-reddit/scripts/reddit.cjs')]) {
test('Selena paths and archive query contract, refusal does not fallback', async () => {
  const calls = []
  const server = http.createServer((req, res) => {
    calls.push(req.url); res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url, 'http://localhost')
    if (url.searchParams.get('q') === 'denied') { res.statusCode = 403; return res.end('{}') }
    if (url.searchParams.get('q') === 'invalid') return res.end('{}')
    const posts = [{ id: 'abc', title: 'Real shape', subreddit: 'robotics', selftext: 'full body', score: 0 }]
    res.end(JSON.stringify(url.pathname.startsWith('/api/') ? { data: posts } : { data: { children: posts.map(data => ({ data })), after: 't3_abc' } }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const api = new RedditAPI({ redditBase: base, archiveBase: base })
    const result = await api.collect({ subreddit: 'robotics', query: 'cleaning robot' })
    const u = new URL(calls[0], base)
    assert.equal(u.pathname, '/r/robotics/search.json'); assert.equal(u.searchParams.get('restrict_sr'), '1')
    assert.equal(u.searchParams.get('sort'), 'top'); assert.equal(u.searchParams.get('t'), 'week'); assert.equal(u.searchParams.get('limit'), '10')
    assert.equal(result.posts[0].text, 'full body'); assert.equal(result.posts[0].score, 0)
    assert.equal(result.coverage.next_cursor, 't3_abc')
    await api.collect({ subreddit: 'robotics' }); assert.match(calls.at(-1), /\/top.json/)
    const archived = await api.collect({ subreddit: 'robotics', query: 'robot', source: 'arcticshift', days: 14 })
    const a = new URL(calls.at(-1), base)
    assert.equal(Number(a.searchParams.get('before')) - Number(a.searchParams.get('after')), 14 * 86400)
    assert.equal(archived.coverage.live_availability_verified, false)
    const before = calls.length
    await assert.rejects(api.collect({ subreddit: 'robotics', query: 'denied' }), /403/)
    assert.equal(calls.length - before, 1)
    await assert.rejects(api.collect({ subreddit: 'robotics', query: 'invalid' }), /Invalid/)
    await assert.rejects(api.collect({ subreddit: '../private' }), /subreddit/)
    await assert.rejects(api.collect({ subreddit: 'robotics', limit: 'NaN' }), /Limit/)
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)) }
})

}
