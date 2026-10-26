// Standalone employee Skill: Node >=18, no npm install or provider secrets.
async function fetch(url, options) {
  const response = await globalThis.fetch(url, options)
  if (!response.ok) await response.body?.cancel()
  return {
    ok: response.ok, status: response.status, headers: response.headers,
    async json() {
      const reader = response.body.getReader(); const chunks = []; let total = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.length
          if (total > 8000000) throw new Error('Source response exceeds 8 MB')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel() }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
  }
}

// Selena's checked-in /reddit implementation: subreddit search, top, week, 10.
// Archive mode is explicit; never switch sources to conceal an access refusal.
class RedditAPI {
  constructor({ timeoutMs = 20000, redditBase = 'https://www.reddit.com', archiveBase = 'https://arctic-shift.photon-reddit.com' } = {}) {
    this.timeoutMs = timeoutMs
    this.redditBase = redditBase
    this.archiveBase = archiveBase
  }
  async collect({ subreddit, query, source = 'selena', limit = 10, days = 7 } = {}) {
    if (!/^[A-Za-z0-9_]{1,21}$/.test(subreddit || '')) throw new Error('Provide a subreddit name without r/')
    if (!['selena', 'arcticshift'].includes(source)) throw new Error('Unknown Reddit source')
    limit = Number(limit); days = Number(days)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be an integer from 1 to 100')
    if (!Number.isFinite(days) || days <= 0 || days > 3660) throw new Error('Days must be between 0 and 3660')
    if (query !== undefined && (!query.trim() || query.length > 500)) throw new Error('Query must contain 1-500 characters')
    if (source === 'selena' && days !== 7) throw new Error('Selena mode uses the original week window; use --source arcticshift for --days')
    const now = Math.floor(Date.now() / 1000)
    const url = source === 'selena'
      ? new URL(`/r/${subreddit}/${query ? 'search' : 'top'}.json`, this.redditBase)
      : new URL('/api/posts/search', this.archiveBase)
    const params = source === 'selena'
      ? { t: 'week', limit, ...(query ? { q: query, restrict_sr: 1, sort: 'top' } : {}) }
      : { subreddit, limit, sort: 'desc', after: now - Math.ceil(days * 86400), before: now, ...(query ? { query } : {}) }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'TopifyCLI/0.5 RedditResearch (read-only)' }, signal: controller.signal, redirect: 'error', size: 8000000 })
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after')
        throw new Error(`Reddit source ${source} returned HTTP ${response.status}${retryAfter ? `; Retry-After: ${retryAfter}` : ''}; no retry or fallback was sent`)
      }
      const data = await response.json()
      const rows = source === 'selena' ? data?.data?.children?.map(p => p.data) : data?.data
      if (!Array.isArray(rows) || !rows.every(p => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.title === 'string')) throw new Error('Invalid Reddit source response; not an empty search')
      const posts = [...new Map(rows.map(p => [p.id, {
        id: p.id, subreddit: p.subreddit || subreddit, title: p.title,
        text: p.selftext || '', author: p.author || null, score: p.score ?? null,
        comments: p.num_comments ?? null, created_utc: p.created_utc ?? null,
        url: `https://www.reddit.com/r/${encodeURIComponent(p.subreddit || subreddit)}/comments/${encodeURIComponent(p.id)}/`,
        removed: Boolean(p.removed_by_category || ['[removed]', '[deleted]'].includes(p.selftext)),
        locked: Boolean(p.locked), archived: Boolean(p.archived),
      }])).values()]
      return {
        source, fetched_at: new Date().toISOString(), subreddit, query: query || null,
        window_days: days, limit, posts,
        coverage: { status: 'bounded_sample', at_limit: rows.length >= limit,
          next_cursor: source === 'selena' ? (data.data.after || null) : null,
          live_availability_verified: false,
          note: source === 'arcticshift' ? 'Archive records may lag or differ from live Reddit; no complete-window claim.' : 'Original Selena top/week sample; not all matching posts.' }
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Reddit request timed out; no retry or fallback was sent')
      throw error
    } finally { clearTimeout(timer) }
  }
}
module.exports = { RedditAPI }
if (require.main === module) {
  const opts = {}; const args = process.argv.slice(2)
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--help') {
        console.log('node reddit.cjs --subreddit robotics [--query "cleaning robot"] [--source selena|arcticshift] [--days 7] [--limit 10]')
        process.exit(0)
      }
      if (!['--subreddit', '--query', '--source', '--days', '--limit'].includes(args[i]) || args[i + 1] === undefined) throw new Error('Unknown or missing argument: ' + args[i])
      opts[args[i].slice(2)] = args[++i]
    }
    new RedditAPI().collect(opts).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1 })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
