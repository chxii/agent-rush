const SCHEMA_URL = './data/executor-schema.json'
const CALL_SCHEMA_KEYS = {
  InitialPlanning: '调用1_InitialPlanning',
  SingleCardPlan: '调用2_SingleCardPlan',
  IncidentResponse: '调用3_IncidentResponse',
  PlayerIntervention: '调用4_PlayerIntervention',
  SettlementReport: '调用5_SettlementReport',
}

export const SchemaValidator = {
  _ajv: null,
  _validators: {},
  _initPromise: null,

  async init() {
    if (this._initPromise) return this._initPromise

    this._initPromise = this._loadSchemas()
    return this._initPromise
  },

  validate(callType, data) {
    const validator = this._validators[callType]
    if (!validator) return { valid: true, errors: [] }

    const valid = validator(data)
    return {
      valid,
      errors: valid ? [] : [...(validator.errors ?? [])],
    }
  },

  async _loadSchemas() {
    const AjvCtor = window.Ajv || window.ajv7 || window.ajv?.default || window.ajv?.Ajv || window.ajv
    if (typeof AjvCtor !== 'function') {
      console.warn('[SchemaValidator] Ajv not found; schema validation is disabled.')
      return
    }

    this._ajv = new AjvCtor({ allErrors: true, strict: false })

    try {
      const response = await fetch(SCHEMA_URL)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const rootSchema = await response.json()
      Object.entries(CALL_SCHEMA_KEYS).forEach(([callType, schemaKey]) => {
        const section = rootSchema[schemaKey]
        if (!section?.output) return

        this._validators[callType] = this._ajv.compile({
          ...section.output,
          definitions: rootSchema.definitions,
        })
      })
    } catch (error) {
      console.warn('[SchemaValidator] Failed to load executor schema; validation is disabled.', error)
      this._validators = {}
    }
  },
}
