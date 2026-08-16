import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LoadIdentities, SaveIdentities } from '../../wailsjs/go/main/App'
import type { Identity, IdentityStoreData } from '../types/identity'

export const useIdentityStore = defineStore('identity', () => {
  const identities = ref<Identity[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const data = (await LoadIdentities()) as IdentityStoreData
      identities.value = data.identities ?? []
    } catch (e) {
      console.error('Failed to load identities:', e)
    } finally {
      loading.value = false
    }
  }

  async function save() {
    await SaveIdentities({ identities: identities.value } as any)
  }

  async function add(id: Identity) {
    identities.value.push(id)
    await save()
  }

  async function update(id: Identity) {
    const i = identities.value.findIndex((x) => x.id === id.id)
    if (i >= 0) identities.value[i] = id
    await save()
  }

  async function remove(id: string) {
    identities.value = identities.value.filter((x) => x.id !== id)
    await save()
  }

  return { identities, loading, load, save, add, update, remove }
})
