export const ExecutorAI = {
  init() {
    if (!window.GLM_API_KEY) {
      console.warn('[ExecutorAI] GLM_API_KEY not found. Mock mode will be used in later phases.')
    }
  },
}
