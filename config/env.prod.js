// Production browser config for Vercel.
// No secrets belong in this file. GLM_API_KEY is injected only in api/llm.js from Vercel env vars.
window.LLM_PROXY_URL = '/api/llm'
window.GLM_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
window.GLM_MODEL = 'glm-5.1'
