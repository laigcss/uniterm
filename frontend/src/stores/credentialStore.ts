import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  GetDataDirInfo, SetDataDir, GetCredentialStatus, SetupCredentials,
  UnlockCredentials, SwitchCredentialMode, ChangeMasterPassword, ResetCredentials,
} from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime'
import type { DataDirInfo, CredentialStatus } from '../types/credentials'

let unsubFirstRun: (() => void) | null = null

export const useCredentialStore = defineStore('credential', () => {
  const dataDirInfo = ref<DataDirInfo>({ dataDir: '', type: 'default', firstRun: false })
  const status = ref<CredentialStatus>({ mode: '', unlocked: false, needsSetup: true, keychainLost: false, existingSecrets: 0 })
  const firstRun = ref(false)

  async function loadDataDir() {
    try { dataDirInfo.value = (await GetDataDirInfo()) as DataDirInfo } catch { /* ignore */ }
  }
  async function loadStatus() {
    try { status.value = (await GetCredentialStatus()) as CredentialStatus } catch { /* ignore */ }
  }
  async function selectDataDir(kind: string, customDir: string, migrate: boolean) {
    await SetDataDir(kind, customDir, migrate)
    await loadDataDir()
    await loadStatus()
  }
  async function setup(mode: string, masterPassword: string) {
    await SetupCredentials(mode, masterPassword)
    await loadStatus()
  }
  async function unlock(masterPassword: string) {
    await UnlockCredentials(masterPassword)
    await loadStatus()
  }
  async function switchMode(targetMode: string, masterPassword: string) {
    await SwitchCredentialMode(targetMode, masterPassword)
    await loadStatus()
  }
  async function changeMasterPassword(oldPassword: string, newPassword: string) {
    await ChangeMasterPassword(oldPassword, newPassword)
    await loadStatus()
  }
  async function reset() {
    await ResetCredentials()
    await loadStatus()
  }

  function watchEvents() {
    unsubFirstRun?.()
    unsubFirstRun = EventsOn('app:firstRun', () => { firstRun.value = true })
  }
  function dispose() {
    unsubFirstRun?.()
    unsubFirstRun = null
  }

  return {
    dataDirInfo, status, firstRun,
    loadDataDir, loadStatus, selectDataDir, setup, unlock, switchMode, changeMasterPassword, reset,
    watchEvents, dispose,
  }
})
