// Free / low-cost AI endpoints through OFFICIAL provider APIs (no scraping of chat websites).
// Each model name tries a chain of providers and uses the first one that is configured and answers.
// Model ids change often, so every id can be overridden with environment variables (MODEL_GEMINI, MODEL_GPT_OPENROUTER, ...) without touching the code.
import { HttpError, fetchT, param } from '../system/util.js';

const chains = (env) => withFree({
  // Every model ends with the Cloudflare Workers AI fallback (free; set CF_ACCOUNT_ID + CF_API_TOKEN), so AI works even with no paid provider key.
  gemini: [['gemini', env.MODEL_GEMINI || 'gemini-2.5-flash'], ['workers-ai', env.MODEL_GEMINI_FALLBACK_CF || '@cf/meta/llama-3.3-70b-instruct-fp8-fast']],
  gpt: [
    ['openrouter', env.MODEL_GPT_OPENROUTER || 'openai/gpt-oss-20b:free'],
    ['groq', env.MODEL_GPT_GROQ || 'openai/gpt-oss-20b'],
    ['workers-ai', env.MODEL_GPT_CF || '@cf/openai/gpt-oss-20b']
  ],
  deepseek: [
    ['deepseek', env.MODEL_DEEPSEEK || 'deepseek-chat'],
    ['openrouter', env.MODEL_DEEPSEEK_OPENROUTER || 'deepseek/deepseek-chat-v3.1:free'],
    ['workers-ai', env.MODEL_DEEPSEEK_CF || '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b']
  ],
  // There is no free Claude API. This needs an OpenRouter key with credits.
  claude: [['openrouter', env.MODEL_CLAUDE || 'anthropic/claude-haiku-4.5'], ['workers-ai', env.MODEL_CLAUDE_FALLBACK_CF || '@cf/meta/llama-3.3-70b-instruct-fp8-fast']],
  gemma: [['openrouter', env.MODEL_GEMMA || 'google/gemma-3-27b-it:free'], ['groq', env.MODEL_GEMMA_GROQ || 'gemma2-9b-it'], ['workers-ai', env.MODEL_GEMMA_CF || '@cf/google/gemma-3-12b-it']],
  kimi: [['openrouter', env.MODEL_KIMI || 'moonshotai/kimi-k2:free'], ['groq', env.MODEL_KIMI_GROQ || 'moonshotai/kimi-k2-instruct']],
  glm: [['openrouter', env.MODEL_GLM || 'z-ai/glm-4.5-air:free']],
  minimax: [['openrouter', env.MODEL_MINIMAX || 'minimax/minimax-m2:free']],
  coder: [['openrouter', env.MODEL_CODER || 'qwen/qwen3-coder:free'], ['groq', env.MODEL_CODER_GROQ || 'openai/gpt-oss-120b'], ['workers-ai', env.MODEL_CODER_CF || '@cf/qwen/qwen2.5-coder-32b-instruct']],
  llama: [
    ['workers-ai', env.MODEL_LLAMA_CF || '@cf/meta/llama-3.1-8b-instruct'],
    ['groq', env.MODEL_LLAMA_GROQ || 'llama-3.1-8b-instant']
  ]
});
// Every model ends with a keyless public fallback (Pollinations), so AI works with ZERO keys. Real keys are tried first.
const PMODEL = { gemini: 'gemini', deepseek: 'deepseek', claude: 'claude', llama: 'llama', coder: 'qwen-coder' }; // best matching Pollinations model per name (others use 'openai')
const withFree = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, [...v, ['pollinations', PMODEL[k] || 'openai']]]));
export const MODEL_NAMES = ['gemini', 'gpt', 'deepseek', 'claude', 'llama', 'gemma', 'kimi', 'glm', 'minimax', 'coder'];

const configured = (prov, env) => ({
  gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, groq: !!env.GROQ_API_KEY,
  deepseek: !!env.DEEPSEEK_API_KEY, pollinations: true, 'workers-ai': !!(env.CF_ACCOUNT_ID && env.CF_API_TOKEN)
}[prov]);

async function openaiStyle(url, key, model, messages, max, extraHeaders = {}) {
  const r = await fetchT(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages, max_tokens: max, temperature: 0.7 })
  }, 28000);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error('empty answer');
  return t;
}

async function run(prov, model, messages, max, env) {
  if (prov === 'gemini') {
    const sys = messages.find((m) => m.role === 'system')?.content;
    const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
    const r = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: user }] }], ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), generationConfig: { maxOutputTokens: max } })
    }, 28000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
    const t = d.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('');
    if (!t) throw new Error('empty answer');
    return t;
  }
  if (prov === 'openrouter') return openaiStyle('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, model, messages, max, { 'X-Title': 'PASIYA API' });
  if (prov === 'groq') return openaiStyle('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, model, messages, max);
  if (prov === 'deepseek') return openaiStyle('https://api.deepseek.com/chat/completions', env.DEEPSEEK_API_KEY, model, messages, max);
  if (prov === 'pollinations') { // https://text.pollinations.ai : free, anonymous. Tries the matching model, then the general one, POST first then plain GET.
    const errs = [];
    for (const m of [...new Set([model, 'openai'])]) {
      try {
        const r = await fetchT('https://text.pollinations.ai/openai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, messages, max_tokens: max }) }, 25000);
        const d = await r.json().catch(() => ({}));
        const t = r.ok && d.choices?.[0]?.message?.content;
        if (t) return t;
        errs.push(`${m}: ${d.error?.message || d.error || 'HTTP ' + r.status}`);
      } catch (e) { errs.push(`${m}: ${e.message}`); }
    }
    try { // last resort: the simple GET endpoint
      const flat = messages.map((x) => (x.role === 'system' ? 'Instruction: ' : '') + x.content).join('\n\n').slice(0, 3500);
      const u = new URL('https://text.pollinations.ai/' + encodeURIComponent(flat)); u.searchParams.set('model', 'openai');
      const r = await fetchT(u, {}, 25000); const t = r.ok && (await r.text()).trim();
      if (t && !t.startsWith('{"error"')) return t;
    } catch (e) { errs.push('get: ' + e.message); }
    throw new Error(errs.join(' / ') || 'empty answer');
  }
  if (prov === 'workers-ai') { // Cloudflare Workers AI over REST (free tier): needs CF_ACCOUNT_ID + CF_API_TOKEN
    const r = await fetchT(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CF_API_TOKEN}` }, body: JSON.stringify({ messages, max_tokens: max })
    }, 28000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) throw new Error(d.errors?.[0]?.message || `HTTP ${r.status}`);
    const x = d.result, t = x?.response ?? x?.choices?.[0]?.message?.content ?? x?.output_text;
    if (!t) throw new Error('empty answer');
    return String(t);
  }
  throw new Error('unknown provider');
}

function makeHandler(forced, persona) {
  return async (p, env) => {
    const name = forced || String(p.model || 'gpt').toLowerCase();
    const prompt = String(p.prompt ?? p.q ?? p.text ?? '').trim();
    if (!prompt) throw new HttpError(400, 'prompt is required (example: ?prompt=Hello).');
    if (prompt.length > 4000) throw new HttpError(400, 'prompt is too long (max 4000 characters).');
    const chain = chains(env)[name];
    if (!chain) throw new HttpError(400, `Unknown model "${name}". Use: ${MODEL_NAMES.join(', ')}`);
    const usable = chain.filter(([prov]) => configured(prov, env));
    if (!usable.length) {
      const need = 'CF_ACCOUNT_ID + CF_API_TOKEN (free Cloudflare Workers AI) or a provider key (GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY)';
      throw new HttpError(503, `The "${name}" model is not enabled on this server. The owner must add ${need}.`);
    }
    const max = Math.min(Number(p.max_tokens) || 700, 1500);
    const messages = [
      ...((p.system || persona) ? [{ role: 'system', content: String(p.system || persona).slice(0, 800) }] : []),
      { role: 'user', content: prompt }
    ];
    const tried = [];
    for (const [prov, model] of usable) {
      try {
        const answer = await run(prov, model, messages, max, env);
        return { model: name, provider: prov, modelId: model, answer: answer.trim() };
      } catch (e) { tried.push(`${prov}: ${e.message}`); }
    }
    throw new HttpError(502, 'All providers failed. ' + tried.join(' | '));
  };
}

const prompt = (ex, sys = true) => [param('prompt', ex, 'Your message'), ...(sys ? [param('system', '', 'Optional instruction', false)] : [])];
const endpoints = [
  { path: '/api/ai/gemini', category: 'AI', name: 'Gemini', cost: 1, desc: 'Google Gemini chat', params: prompt('Explain Sri Lanka in 2 lines'), run: makeHandler('gemini') },
  { path: '/api/ai/gpt', category: 'AI', name: 'GPT', cost: 1, desc: 'Open GPT model chat (free tiers first)', params: prompt('Write a haiku about rain'), run: makeHandler('gpt') },
  { path: '/api/ai/deepseek', category: 'AI', name: 'DeepSeek', cost: 1, desc: 'DeepSeek chat', params: prompt('What is 17 * 23?'), run: makeHandler('deepseek') },
  { path: '/api/ai/claude', category: 'AI', name: 'Claude', cost: 2, desc: 'Claude chat (real Claude with an OpenRouter key, otherwise a free Llama fallback)', params: prompt('Give me 3 startup ideas'), run: makeHandler('claude') },
  { path: '/api/ai/llama', category: 'AI', name: 'Llama', cost: 1, desc: 'Llama chat on Cloudflare Workers AI / Groq', params: prompt('Tell me a joke', false), run: makeHandler('llama') },
  ...[
    // [path, name, model chain, cost, description, persona]
    ['/api/chatgpt', 'ChatGPT', 'gpt', 1, 'ChatGPT-style AI chat - ask anything in Sinhala or English, with an optional custom system prompt', null, 'Tell me a fun fact about Sri Lanka'],
    ['/api/deepseek-v4-flash', 'DeepSeek Fast', 'deepseek', 1, 'DeepSeek - fast, precise reasoning AI for hard questions and logic', 'Think carefully and answer precisely. Show short step-by-step reasoning for maths and logic.', 'If 3x + 5 = 20, what is x?'],
    ['/api/gemma', 'Gemma', 'gemma', 1, "Google's open lightweight model - helpful, concise answers", null, 'Explain photosynthesis simply'],
    ['/api/kimi-k2.7', 'Kimi', 'kimi', 1, "Moonshot AI's long-context thinking model - step-by-step reasoning", 'Reason step by step, then give a clear final answer.', 'Plan a 3 day trip to Kandy'],
    ['/api/glm-5v-turbo', 'GLM', 'glm', 1, "Zhipu AI's fast assistant - great with code and structured answers", null, 'Write a JSON example of a user profile'],
    ['/api/minimax-m2.7', 'MiniMax', 'minimax', 1, 'Fast and capable general assistant - clear, direct, high-quality answers', null, 'Give me 5 study tips'],
    ['/api/gpt-5.3-codex', 'Coder', 'coder', 1, 'Coding specialist - complete runnable code with short explanations', 'You are an expert programmer. Reply with complete runnable code first, then a short explanation.', 'Python function to reverse a string'],
    ['/api/blackbox', 'BlackBox Coder', 'coder', 1, 'Elite coding assistant - complete runnable code with short explanations', 'You are an elite coding assistant. Give complete runnable code in a code block and a very short explanation.', 'JavaScript debounce function'],
    ['/api/perplexity', 'Answer Engine', 'gpt', 1, 'Direct answers first, then key points - precise answer-engine style (no live web access)', 'Answer directly in the first sentence, then give 3-5 short key points. Be precise. Say so if you are unsure.', 'What is the capital of Australia?'],
    ['/api/duckduckgo-ai', 'Quick Answers', 'llama', 1, 'Privacy-first, short and useful answers', 'Give short, useful answers (max 5 sentences).', 'What is DNS?'],
    ['/api/notegpt', 'NoteGPT', 'gpt', 1, 'Turn any text into clean notes, summaries, bullet points or flashcards', 'You turn the user text into clean study notes: a 1-line summary, bullet points, then 3 flashcards (Q/A). Keep the language of the text.', 'Paste any paragraph or topic here']
  ].map(([path, name, model, cost, desc, persona, ex]) => ({ path, category: 'AI', name, cost, isNew: true, desc, params: prompt(ex), run: makeHandler(model, persona) })),
  { path: '/api/ai/chat', hidden: true, cost: 1, run: makeHandler(null) }
];

// ---- AI image generation: returns a direct image link (keyless, via Pollinations) ----
const imageUrl = (p, model) => {
  const q = String(p.prompt ?? p.q ?? '').trim();
  if (!q || q.length > 500) throw new HttpError(400, 'prompt is required (max 500 characters).');
  const size = (v, d) => Math.min(1536, Math.max(256, Number(v) || d));
  const u = new URL('https://image.pollinations.ai/prompt/' + encodeURIComponent(q));
  u.searchParams.set('width', size(p.width, 1024)); u.searchParams.set('height', size(p.height, 1024)); u.searchParams.set('model', model); u.searchParams.set('nologo', 'true');
  if (p.seed) u.searchParams.set('seed', String(p.seed).slice(0, 10));
  return { prompt: q, model, image: u.toString(), note: 'Open the link to see / download the image (it renders on first open, can take ~10-20s).' };
};
const img = (path, name, model, desc) => ({ path, category: 'AI', name, cost: 1, isNew: true, desc, params: [param('prompt', 'a cat astronaut on the moon, digital art', 'What to draw'), param('width', '1024', '256-1536', false), param('height', '1024', '256-1536', false)], run: async (p) => imageUrl(p, model) });
export const images = [
  img('/api/ai/image/flux', 'AI Image (Flux)', 'flux', 'Text to image generator (Flux) - returns a direct image link'),
  img('/api/nanobanana', 'Nano Banana', 'gptimage', 'AI image generator - type any prompt, get a generated image with a direct link')
];

export default [...endpoints, ...images];
