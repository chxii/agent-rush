export function createMemoryStorage(initialData = {}) {
  const entries = new Map(Object.entries(initialData))

  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null
    },

    setItem(key, value) {
      entries.set(key, String(value))
    },

    removeItem(key) {
      entries.delete(key)
    },

    clear() {
      entries.clear()
    },

    dump() {
      return Object.fromEntries(entries)
    },
  }
}

export function createBrowserStorage(storage) {
  if (!storage) return createMemoryStorage()

  return {
    getItem(key) {
      return storage.getItem(key)
    },

    setItem(key, value) {
      storage.setItem(key, String(value))
    },

    removeItem(key) {
      storage.removeItem(key)
    },
  }
}
