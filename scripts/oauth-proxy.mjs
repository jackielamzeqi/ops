/**
 * 本地 / 轻量部署用 GitHub OAuth 代理（解决浏览器 CORS）
 * 用法：node scripts/oauth-proxy.mjs
 * 默认监听 http://127.0.0.1:8787 ，生产可配合反向代理。
 */
import http from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*'

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
  })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '')

  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const path = url.pathname

  if (req.method === 'GET' && path === '/health') {
    return send(res, 200, { ok: true })
  }

  const allowed = ['/login/device/code', '/login/oauth/access_token']
  if (req.method === 'POST' && allowed.includes(path)) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    try {
      const upstream = await fetch(`https://github.com${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'personal-ops-oauth-proxy',
        },
        body: raw || '{}',
      })
      const text = await upstream.text()
      return send(res, upstream.status, text, 'application/json')
    } catch (e) {
      return send(res, 502, { error: String(e) })
    }
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`GitHub OAuth proxy: http://127.0.0.1:${PORT}`)
})
