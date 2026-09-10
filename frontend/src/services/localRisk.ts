// S2: AI Agent 本地危险命令防线
//
// assessLocalRisk 对一条 shell 命令做纯模式匹配，独立于 LLM 自声明的
// `input.risk` 字段。agent.ts 的 getRisk 会取 max(modelRisk, localRisk)，
// 这样即使被 prompt injection 劫持的模型把 `rm -rf ~` 声明为 risk:"read"
// 也无法绕过用户确认。
//
// 这是"纵深防御"而非绝对防线：base64/变量拼接等绕过检测不可能穷尽，
// 只能覆盖常见模式。文档中需说明这一点。
//
// 评级语义：
//   - 'read'      只读、无副作用（默认）
//   - 'write'     修改/创建数据，但不系统级破坏
//   - 'dangerous' 潜在破坏性或系统级影响

export type LocalRiskLevel = 'read' | 'write' | 'dangerous'

// ---- 危险模式黑名单（强制 dangerous） ----
// 用正则做大小写不敏感匹配；命令前可能有空白、变量赋值、sudo/doas 前缀，
// 所以一律用 \b 边界 + 任意前缀通配。
const DANGEROUS_PATTERNS: RegExp[] = [
  // rm -rf / rm -fr（任意路径，含 ~、*、$HOME）。
  // flag 可能与其他短选项组合（-rfv / -frv），所以 r 与 f 之间允许任意字母，
  // 且不要求 flag 串结尾（去掉 \b），用 \s 确保 flag 后是空白即命令参数边界。
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s/,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s/,
  // rm --recursive --force（长选项形式）
  /\brm\s+[^&|;]*--recursive[^&|;]*--force/,
  /\brm\s+[^&|;]*--force[^&|;]*--recursive/,
  // mkfs 系列（mkfs.ext4 / mkfs.vfat / mkswap）
  /\bmkfs\b/,
  /\bmkswap\b/,
  // dd 写块设备：dd if=...of=/dev/... 或 dd of=/dev/...
  /\bdd\b[^|;&]*\bof=\/dev\//,
  // chmod -R 777 / 或 chmod 777 /（系统级权限破坏）
  /\bchmod\s+(-R\s+)?777\s+\/(?:\s|$|;|&|\|)/,
  // chmod -R 000 /（剥夺所有权限）
  /\bchmod\s+-R\s+000\s+\/(?:\s|$|;|&|\|)/,
  // curl/wget 管道到 shell（远程脚本执行）
  /\b(curl|wget)\b[^|;&]*\|\s*(sh|bash|zsh|fish|python|python3|perl|ruby)\b/,
  // fork bomb :(){ :|:& };:
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  // 直接重定向到块设备 > /dev/sda
  />\s*\/dev\/(?:sd|nvme|hd|vd|disk)/,
  // shutdown / reboot / halt / poweroff
  /\b(shutdown|reboot|halt|poweroff)\b/,
  // kill -9 1（杀 init）
  /\bkill\s+-9\s+1\b/,
  /\bkill\s+-KILL\s+1\b/,
  // killall / pkill -9（批量强杀）
  /\bkillall\b/,
  /\bpkill\s+-9\b/,
  /\bpkill\s+-KILL\b/,
]

// ---- 写操作模式（write） ----
// 命中即 write；若同时命中 DANGEROUS 则取 dangerous（在 assessLocalRisk 里合并）。
const WRITE_PATTERNS: RegExp[] = [
  // 文件系统修改：rm（非 -rf，-rf 已被危险匹配）、mv、chmod、chown、mkdir、touch
  /\brm\b/,
  /\bmv\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  // 输出重定向 > / >>（写文件）
  />>?/,
  // 包管理器安装
  /\bapt(?:-get)?\s+install\b/,
  /\baptitude\s+install\b/,
  /\byum\s+install\b/,
  /\bdnf\s+install\b/,
  /\bbrew\s+install\b/,
  /\bpip\s+install\b/,
  /\bpip3\s+install\b/,
  /\bnpm\s+install\b/,
  /\bnpx\s+install\b/,
  /\byarn\s+add\b/,
  // docker 容器/镜像销毁
  /\bdocker\s+rm\b/,
  /\bdocker\s+rmi\b/,
  /\bdocker\s+stop\b/,
  /\bdocker\s+kill\b/,
  /\bdocker\s+container\s+rm\b/,
  // kubectl delete
  /\bkubectl\s+delete\b/,
  // systemctl stop/disable
  /\bsystemctl\s+stop\b/,
  /\bsystemctl\s+disable\b/,
  // iptables -F（清空防火墙规则）
  /\biptables\s+-F\b/,
  /\biptables\s+--flush\b/,
  // 用户管理
  /\buserdel\b/,
  /\busermod\b/,
  /\bgroupdel\b/,
]

// ---- 反绕过检测（一律 dangerous） ----
// 这些模式试图隐藏真实命令，无法静态展开，统一按危险处理。
const BYPASS_PATTERNS: RegExp[] = [
  // base64 解码后管道执行：echo ...|base64 -d|sh
  /\bbase64\b[^|;&]*\|\s*(sh|bash|zsh|fish|python|python3|perl|ruby)\b/,
  // sh -c / bash -c / zsh -c 内层命令
  /\b(sh|bash|zsh|fish)\s+-c\b/,
  // eval 内层命令
  /\beval\b/,
  // $() 命令替换
  /\$\(/,
  // 反引号命令替换
  /`/,
  // 变量拼接执行：a="rm"; $a  —— 形如 var="..." 后 $var 出现
  // 检测 "$" 紧跟字母且前面有变量赋值，简化为：出现 $VAR 形式的命令调用
  /\$\w+\s/,
]

/**
 * 评估单条命令的本地风险等级。
 *
 * 不依赖模型声明，纯模式匹配。命令可能是复合命令（&&、||、;、|），
 * 对整条字符串做正则扫描即可：任何子命令命中危险模式则整条危险，
 * 任何子命令命中写模式则整条至少 write。
 *
 * 反绕过模式（base64/sh -c/eval/$()/变量拼接）一律按 dangerous 处理，
 * 因为无法静态判断内层命令的真实意图。
 *
 * 默认返回 'read'（无匹配）。
 */
export function assessLocalRisk(command: string): LocalRiskLevel {
  if (!command || typeof command !== 'string') return 'read'

  // 反绕过优先：一旦命中，直接 dangerous，不再继续。
  for (const re of BYPASS_PATTERNS) {
    if (re.test(command)) return 'dangerous'
  }

  let isDangerous = false
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(command)) {
      isDangerous = true
      break
    }
  }

  let isWrite = false
  for (const re of WRITE_PATTERNS) {
    if (re.test(command)) {
      isWrite = true
      break
    }
  }

  if (isDangerous) return 'dangerous'
  if (isWrite) return 'write'
  return 'read'
}