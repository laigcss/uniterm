/**
 * useCredentials (A1 重构)
 *
 * 下沉 App.vue 中凭据相关逻辑：
 *   1) 凭据提示对话框（CredentialPrompt）：showCredentialDialog / onCredentialResolve
 *      + ensureCredentials / needsCredentialCheck
 *   2) 首次运行 / 加密 / 解锁 / keychain 丢失对话框：checkCredentials /
 *      onDataDirDone / onEncryptDone / onUnlockDone / onKeychainLostDone / onReset
 *
 * App.vue 用法：
 *   const cred = useCredentials()
 *   provide('showCredentialDialog', cred.showCredentialDialog)
 *   onMounted(() => cred.checkCredentials())
 *   // 模板绑定 cred.credentialVisible / credentialTitle / ... / dataDirVisible / ...
 *
 * 依赖的 store 在内部实例化（pinia 单例，与 App.vue 共享）。
 */
import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useCredentialStore } from '../stores/credentialStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useQuickCommandStore } from '../stores/quickCommandStore'
import { useSkillStore } from '../stores/skillStore'
import { useCommandStore } from '../stores/commandStore'
import { useTunnelStore } from '../stores/tunnelStore'
import { useI18n } from '../i18n'
import { RelaunchApp } from '../../bindings/github.com/ys-ll/uniterm/app'
import type { ConnectionConfig } from '../types/session'
import type { CredentialResult } from '../components/CredentialPrompt.vue'

export function useCredentials() {
  const { t } = useI18n()
  const credStore = useCredentialStore()
  const connectionStore = useConnectionStore()
  const settingsStore = useSettingsStore()
  const tunnelStore = useTunnelStore()

  // ── Credential prompt dialog ──
  const credentialVisible = ref(false)
  const credentialTitle = ref('')
  const credentialSubtitle = ref('')
  const credentialFields = ref<('user' | 'password')[]>([])
  const credentialResolve = ref<((result: CredentialResult | null) => void) | null>(null)
  const credentialInitialUser = ref('')
  const credentialInitialPassword = ref('')

  function showCredentialDialog(
    title: string,
    subtitle: string,
    fields: ('user' | 'password')[],
    initialUser = '',
    initialPassword = ''
  ): Promise<CredentialResult | null> {
    return new Promise((resolve) => {
      credentialTitle.value = title
      credentialSubtitle.value = subtitle
      credentialFields.value = fields
      credentialInitialUser.value = initialUser
      credentialInitialPassword.value = initialPassword
      credentialResolve.value = resolve
      credentialVisible.value = true
    })
  }

  function onCredentialResolve(result: CredentialResult | null) {
    credentialVisible.value = false
    if (credentialResolve.value) {
      credentialResolve.value(result)
      credentialResolve.value = null
    }
  }

  function needsCredentialCheck(config: ConnectionConfig): boolean {
    const inScope = ['ssh', 'mosh', 'sftp', 'scp', 'ftp'].includes(config.type)
    if (!inScope) return false
    if ((config.type === 'ssh' || config.type === 'mosh' || config.type === 'scp' || config.type === 'sftp') && (config.authType === 'key' || config.authType === 'keyText')) return false
    // 身份认证：账密来自身份库，由后端 materializeIdentity 解析，无需补全提示
    if (config.authType === 'identity') return false
    return !config.user || !config.password
  }

  async function ensureCredentials(config: ConnectionConfig): Promise<ConnectionConfig | null> {
    // 1. Check SSH tunnel connection first
    if (config.tunnelSSHConnId) {
      const tunnelConn = connectionStore.connections.find(c => c.id === config.tunnelSSHConnId)
      if (tunnelConn && needsCredentialCheck(tunnelConn)) {
        const result = await showCredentialDialog(
          t('credential.tunnelTitle'),
          t('credential.tunnelSubtitle', { name: tunnelConn.name }),
          ['user', 'password'],
          tunnelConn.user,
          tunnelConn.password
        )
        if (!result) return null
        // Pass credentials inline so Go can apply them without reading the store
        config.tunnelSSHUser = result.user || tunnelConn.user
        config.tunnelSSHPassword = result.password || tunnelConn.password
        if (result.action === 'save_and_connect') {
          await connectionStore.update(tunnelConn.id, {
            user: config.tunnelSSHUser,
            password: config.tunnelSSHPassword
          })
        }
      }
    }

    // 2. Check main connection
    if (!needsCredentialCheck(config)) return config

    const result = await showCredentialDialog(
      t('credential.title'),
      '',
      ['user', 'password'],
      config.user,
      config.password
    )
    if (!result) return null
    // Create new object instead of mutating the original (which may be
    // referenced by the Pinia store). For "save_and_connect" we explicitly
    // persist via connectionStore.update below.
    config = {
      ...config,
      user: result.user || config.user,
      password: result.password || config.password
    }
    if (result.action === 'save_and_connect') {
      await connectionStore.update(config.id, { user: config.user, password: config.password })
    }
    return config
  }

  // ── First-run / encryption / unlock / keychain-lost flow ──
  const dataDirVisible = ref(false)
  const encryptVisible = ref(false)
  const unlockVisible = ref(false)
  const keychainLostVisible = ref(false)

  function resolveCredentialDialog() {
    if (credStore.status.keychainLost) { keychainLostVisible.value = true; return }
    if (credStore.status.needsSetup) { encryptVisible.value = true; return }
    if (!credStore.status.unlocked && credStore.status.mode === 'master-password') {
      unlockVisible.value = true
    }
  }

  function onDataDirDone(restart: boolean) {
    if (restart) {
      ElMessageBox.confirm(t('dataDir.restartMsg'), t('dataDir.restartTitle'),
        { confirmButtonText: t('settings.restartNow'), cancelButtonText: t('conn.cancel'), type: 'warning' })
        .then(() => RelaunchApp()).catch(() => {})
      return
    }
    // Backend just initialized the stores for the newly selected data dir. Reload
    // so the frontend reflects existing connections/settings/quick-commands/tunnels.
    // When credentials are still locked the loads come back empty and onUnlockDone
    // re-loads after unlock.
    connectionStore.load()
    settingsStore.reload()
    useQuickCommandStore().load()
    useSkillStore().reload()
    useCommandStore().reload()
    tunnelStore.load()
    resolveCredentialDialog()
  }

  function onEncryptDone() { connectionStore.load() }
  function onUnlockDone() {
    connectionStore.load()
    settingsStore.reload()
  }
  function onKeychainLostDone() { credStore.reset().then(() => { encryptVisible.value = true }) }
  async function onReset() {
    try {
      await ElMessageBox.confirm(t('unlock.resetConfirm'), t('unlock.reset'), { type: 'warning' })
      await credStore.reset()
      encryptVisible.value = true
      unlockVisible.value = false
    } catch { /* cancelled */ }
  }

  async function checkCredentials() {
    credStore.watchEvents()
    await credStore.loadDataDir()
    await credStore.loadStatus()
    // Backend unreachable (wails3 dev browser preview): every binding call
    // rejects and the placeholder status would wrongly pop the encryption
    // dialog. Skip the whole credential flow so the UI renders for debugging.
    if (!credStore.backendAvailable) {
      console.warn('[ai-ops-terminal] Backend unreachable — browser debug mode: credential flow skipped')
      return
    }
    if (credStore.firstRun || credStore.dataDirInfo.firstRun) {
      dataDirVisible.value = true
      return
    }
    resolveCredentialDialog()
  }

  return {
    credStore,
    // credential prompt
    credentialVisible,
    credentialTitle,
    credentialSubtitle,
    credentialFields,
    credentialInitialUser,
    credentialInitialPassword,
    showCredentialDialog,
    onCredentialResolve,
    needsCredentialCheck,
    ensureCredentials,
    // first-run flow
    dataDirVisible,
    encryptVisible,
    unlockVisible,
    keychainLostVisible,
    onDataDirDone,
    onEncryptDone,
    onUnlockDone,
    onKeychainLostDone,
    onReset,
    checkCredentials,
  }
}