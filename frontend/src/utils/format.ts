/**
 * 字节大小格式化工具。
 *
 * 将字节数转换为带单位的人类可读字符串，支持 B / KB / MB / GB / TB。
 * 用于网络流量、传输进度、磁盘容量等场景。
 */

/** 字节单位，按 1024 进制递增。 */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const BYTE_BASE = 1024

/**
 * 将字节数格式化为带单位的字符串。
 *
 * @param bytes 字节数
 * @param decimals 保留小数位数，默认 1
 * @returns 形如 `1.5 MB` 的字符串；当入参非法或为 0 时返回 `0 B`
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTE_BASE)),
    BYTE_UNITS.length - 1,
  )
  const value = bytes / Math.pow(BYTE_BASE, unitIndex)
  return `${parseFloat(value.toFixed(decimals))} ${BYTE_UNITS[unitIndex]}`
}