import type { App } from 'vue'
import VxeUITable from 'vxe-table'
import VxeUI from 'vxe-pc-ui'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'

export function setupVxe(app: App) {
  app.use(VxeUI)
  app.use(VxeUITable)
}
