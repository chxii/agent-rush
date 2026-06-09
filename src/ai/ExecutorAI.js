import { ExecutorMock } from './ExecutorMock.js'
import { SchemaValidator } from './SchemaValidator.js'

export const ExecutorAI = {
  _ready: null,

  init() {
    if (!window.GLM_API_KEY) {
      console.warn('[ExecutorAI] GLM_API_KEY not found. Using ExecutorMock for phase 3.')
    }

    this._ready = SchemaValidator.init()
    return this._ready
  },

  async call(callType, input = {}) {
    await this.ensureReady()
    return ExecutorMock.call(callType, input)
  },

  async callStreaming(callType, input = {}, onChunk = () => {}) {
    await this.ensureReady()
    return ExecutorMock.callStreaming(callType, input, onChunk)
  },

  async ensureReady() {
    if (!this._ready) this.init()
    await this._ready
  },
}
