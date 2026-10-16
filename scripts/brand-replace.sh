#!/bin/bash
# brand-replace.sh — 上游 merge 后运行，恢复 ai-ops-terminal 品牌标识
#
# 用法：在 merge upstream/main 解决冲突后执行
#   cd /path/to/uniterm && bash scripts/brand-replace.sh
#
# 原理：上游代码硬编码 "uniTerm" 品牌名，本脚本替换为 "ai-ops-terminal"。
# 只替换用户可见的品牌文本，不改代码内部标识符（userAgent、service name 等），
# 以减少和上游的差异面。
#
# 冲突处理：merge 时如果品牌行冲突，接受上游版本（含 "uniTerm"），
# 然后运行本脚本恢复品牌。

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 品牌替换：uniTerm → ai-ops-terminal ==="

# --- 前端 HTML ---
sed -i '' 's|<title>uniTerm</title>|<title>ai-ops-terminal</title>|g' frontend/index.html 2>/dev/null || true

# --- Vue 组件：用户可见品牌文本 ---
# StartTabContent.vue 欢迎页大标题
sed -i '' 's|>uniTerm</div>|>ai-ops-terminal</div>|g' frontend/src/components/StartTabContent.vue 2>/dev/null || true
# SettingsTab.vue 关于页
sed -i '' 's|<div class="about-appname">uniTerm</div>|<div class="about-appname">ai-ops-terminal</div>|g' frontend/src/components/SettingsTab.vue 2>/dev/null || true

# --- TypeScript：配置标签和主题名 ---
sed -i '' "s/{ label: 'uniTerm', value: 'uniTerm' }/{ label: 'ai-ops-terminal', value: 'uniTerm' }/g" frontend/src/types/settings.ts 2>/dev/null || true
sed -i '' "s/{ label: 'uniTerm Dark'/{ label: 'ai-ops-terminal Dark'/g" frontend/src/types/settings.ts 2>/dev/null || true
sed -i '' "s/{ label: 'uniTerm Light'/{ label: 'ai-ops-terminal Light'/g" frontend/src/types/settings.ts 2>/dev/null || true

# --- AI Store：系统提示词和标题 ---
sed -i '' 's/inside uniTerm, a terminal emulator/inside ai-ops-terminal, a terminal emulator/g' frontend/src/stores/aiStore.ts 2>/dev/null || true
sed -i '' 's/uniTerm AI Assistant/ai-ops-terminal AI Assistant/g' frontend/src/stores/aiStore.ts 2>/dev/null || true

# --- i18n 文件：所有语言的 "uniTerm" → "ai-ops-terminal" ---
for f in frontend/src/i18n/locales/*.json; do
  if [ -f "$f" ]; then
    python3 -c "
import json, sys
with open('$f', 'r') as fh:
    data = json.load(fh)
changed = False
for k, v in data.items():
    if isinstance(v, str) and 'uniTerm' in v:
        data[k] = v.replace('uniTerm', 'ai-ops-terminal')
        changed = True
if changed:
    with open('$f', 'w') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f'  ✅ {\"$f\"}')
" 2>/dev/null || true
  fi
done

echo "=== 品牌替换完成 ==="
echo "提示：运行 go build ./... 和 vite build 验证编译"