/**
 * Daylog AI 生产代理（Cloudflare Worker 版）
 * 与 scripts/daylog-ai-proxy.mjs 行为一致：POST /chat → OpenAI 兼容 /chat/completions
 *
 * 部署步骤：
 *   1. npm i -g wrangler && wrangler login
 *   2. wrangler secret put DAYLOG_AI_API_KEY --name daylog-ai-proxy   # 粘贴密钥
 *   3. （可选）在 Cloudflare 控制台或 wrangler.toml 配置变量：
 *        DAYLOG_AI_BASE_URL（默认 https://api.moonshot.cn/v1）
 *        DAYLOG_AI_MODEL（默认 moonshot-v1-8k）
 *      也可用 wrangler secret put 覆盖
 *   4. wrangler deploy worker/daylog-ai-proxy.js --name daylog-ai-proxy --compatibility-date 2024-12-01
 *   5. 将得到的 https://daylog-ai-proxy.<account>.workers.dev 配到前端环境变量
 *      VITE_DAYLOG_AI_PROXY，重新构建发布
 */

const DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1'
const DEFAULT_MODEL = 'moonshot-v1-8k'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, hasKey: Boolean(env.DAYLOG_AI_API_KEY) })
    }

    if (request.method === 'POST' && url.pathname === '/chat') {
      const apiKey = env.DAYLOG_AI_API_KEY
      if (!apiKey) {
        return json(
          { error: 'Worker 未配置 DAYLOG_AI_API_KEY，请执行 wrangler secret put DAYLOG_AI_API_KEY' },
          500
        )
      }
      const baseUrl = (env.DAYLOG_AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
      const model = env.DAYLOG_AI_MODEL || DEFAULT_MODEL

      let payload
      try {
        payload = await request.json()
      } catch {
        return json({ error: '请求体不是合法 JSON' }, 400)
      }
      if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
        return json({ error: '缺少 messages 字段' }, 400)
      }

      try {
        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: payload.messages,
            temperature: 0.7,
            ...(payload.responseJson ? { response_format: { type: 'json_object' } } : {}),
          }),
        })
        const data = await upstream.json().catch(() => null)
        if (!upstream.ok) {
          return json(
            { error: data?.error?.message || `上游 AI 接口返回 ${upstream.status}` },
            upstream.status
          )
        }
        return json({ text: data?.choices?.[0]?.message?.content ?? '' })
      } catch (e) {
        return json({ error: `请求上游 AI 接口失败：${String(e)}` }, 502)
      }
    }

    return json({ error: 'not found' }, 404)
  },
}
