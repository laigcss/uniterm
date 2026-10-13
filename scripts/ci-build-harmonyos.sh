#!/bin/bash
set -euo pipefail

# CI 环境鸿蒙构建脚本
# 面向 GitHub Actions 等 CI 环境，封装完整的鸿蒙构建流程
# 与 build-harmonyos.sh 的区别：面向 CI 环境，输出更详细日志，
# 支持环境变量配置，产物路径标准化，生成校验和文件
#
# 用法: scripts/ci-build-harmonyos.sh
#
# 环境变量:
#   VERSION         版本号（默认: 从 git tag 或 dev）
#   SKIP_FRONTEND   设为 "true" 跳过前端构建（默认: false）
#   OUTPUT_DIR      产物输出目录（默认: dist）
#   GITHUB_TOKEN    GitHub Token，用于后续 Release 步骤（可选）
#
# 产物:
#   {OUTPUT_DIR}/ai-ops-terminal-harmonyos-{version}-linux-arm64
#   {OUTPUT_DIR}/SHA256SUMS
#
# 示例:
#   scripts/ci-build-harmonyos.sh
#   VERSION=v1.0.0 scripts/ci-build-harmonyos.sh
#   SKIP_FRONTEND=true scripts/ci-build-harmonyos.sh

# -----------------------------------------------------------------------------
# 常量
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MIN_GO_MAJOR=1
MIN_GO_MINOR=27

TARGET_GOOS="linux"
TARGET_GOARCH="arm64"
BUILD_TAGS="server,production"

# 产物基础名（不含版本和架构后缀）
PRODUCT_NAME="ai-ops-terminal-harmonyos"

# -----------------------------------------------------------------------------
# 辅助函数
# -----------------------------------------------------------------------------

# CI 日志：带时间戳和级别前缀
ci_log()   { printf '::group::==> %s\n' "$*"; }
ci_end()   { printf '::endgroup::\n'; }
log()      { printf '==> %s\n' "$*"; }
info()     { printf '    %s\n' "$*"; }
warn()     { printf 'WARN: %s\n' "$*" >&2; }
die()      { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# 比较版本号: version_ge <major> <minor> <min_major> <min_minor>
# 返回 0 (true) 若 major.minor >= min_major.min_minor，否则返回 1 (false)
version_ge() {
    local major="$1" minor="$2" min_major="$3" min_minor="$4"
    if [ "$major" -gt "$min_major" ]; then
        return 0
    elif [ "$major" -eq "$min_major" ] && [ "$minor" -ge "$min_minor" ]; then
        return 0
    fi
    return 1
}

# 人类可读的文件大小
human_size() {
    local bytes="$1"
    if [ "$bytes" -ge 1048576 ]; then
        awk -v b="$bytes" 'BEGIN{printf "%.1f MB", b/1048576}'
    elif [ "$bytes" -ge 1024 ]; then
        awk -v b="$bytes" 'BEGIN{printf "%.1f KB", b/1024}'
    else
        printf '%d B' "$bytes"
    fi
}

# 获取版本号，优先级: 环境变量 > git tag > dev
resolve_version() {
    if [ -n "${VERSION:-}" ]; then
        printf '%s' "$VERSION"
        return
    fi
    local tag
    if tag="$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 2>/dev/null)"; then
        printf '%s' "$tag"
    else
        printf 'dev'
    fi
}

# -----------------------------------------------------------------------------
# 环境变量读取
# -----------------------------------------------------------------------------
SKIP_FRONTEND="${SKIP_FRONTEND:-false}"
OUTPUT_DIR="${OUTPUT_DIR:-dist}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

VERSION="$(resolve_version)"

# 产物文件名：包含版本号和架构信息
ARTIFACT_NAME="${PRODUCT_NAME}-${VERSION}-${TARGET_GOOS}-${TARGET_GOARCH}"
ARTIFACT_PATH="${OUTPUT_DIR}/${ARTIFACT_NAME}"
CHECKSUM_FILE="${OUTPUT_DIR}/SHA256SUMS"

# -----------------------------------------------------------------------------
# CI 环境检测
# -----------------------------------------------------------------------------
ci_log "CI 环境检测"
info "CI = ${CI:-false}"
info "GITHUB_ACTIONS = ${GITHUB_ACTIONS:-false}"
info "GITHUB_REF = ${GITHUB_REF:-（未设置）}"
info "GITHUB_REF_NAME = ${GITHUB_REF_NAME:-（未设置）}"
info "RUNNER_OS = ${RUNNER_OS:-（未设置）}"
if [ -n "$GITHUB_TOKEN" ]; then
    info "GITHUB_TOKEN: 已设置"
else
    info "GITHUB_TOKEN: 未设置（Release 步骤将不可用）"
fi
ci_end

# -----------------------------------------------------------------------------
# 环境检查
# -----------------------------------------------------------------------------
ci_log "检查构建环境"

# 检查 Go
command -v go >/dev/null 2>&1 || die "未找到 go 命令，请先安装 Go >= ${MIN_GO_MAJOR}.${MIN_GO_MINOR}"
GO_VERSION_RAW="$(go version)"
GO_VERSION_NUM="$(printf '%s' "$GO_VERSION_RAW" | sed -n 's/.*go\([0-9]*\)\.\([0-9]*\)\.[0-9]*.*/\1.\2/p')"
if [ -z "$GO_VERSION_NUM" ]; then
    die "无法解析 Go 版本号: $GO_VERSION_RAW"
fi
GO_MAJOR="${GO_VERSION_NUM%%.*}"
GO_MINOR="${GO_VERSION_NUM##*.}"
if ! version_ge "$GO_MAJOR" "$GO_MINOR" "$MIN_GO_MAJOR" "$MIN_GO_MINOR"; then
    die "Go 版本过低: 需要 >= ${MIN_GO_MAJOR}.${MIN_GO_MINOR}，当前为 ${GO_MAJOR}.${GO_MINOR}"
fi
info "Go 版本: ${GO_MAJOR}.${GO_MINOR} ($GO_VERSION_RAW)"

# 检查 Node.js / npm
command -v npm >/dev/null 2>&1 || die "未找到 npm 命令"
NODE_VERSION="$(node --version 2>/dev/null || echo '未知')"
NPM_VERSION="$(npm --version 2>/dev/null || echo '未知')"
info "Node.js: $NODE_VERSION"
info "npm: $NPM_VERSION"

# 检查 file 命令（用于产物验证）
command -v file >/dev/null 2>&1 || die "未找到 file 命令，无法验证二进制格式"

# 检查 sha256sum 命令（用于生成校验和）
command -v sha256sum >/dev/null 2>&1 || die "未找到 sha256sum 命令，无法生成校验和"

ci_end

# -----------------------------------------------------------------------------
# 前端构建
# -----------------------------------------------------------------------------
FRONTEND_DIST="$PROJECT_ROOT/frontend/dist"

if [ "$SKIP_FRONTEND" = "true" ]; then
    log "跳过前端构建 (SKIP_FRONTEND=true)"
else
    ci_log "构建前端 (frontend/dist)"
    (
        cd "$PROJECT_ROOT/frontend"
        npm ci
        npm run build
    )
    ci_end
fi

# 检查 frontend/dist 是否存在且非空
if [ ! -d "$FRONTEND_DIST" ]; then
    die "前端构建产物目录不存在: $FRONTEND_DIST"
fi
DIST_FILE_COUNT="$(find "$FRONTEND_DIST" -type f | wc -l | tr -d ' ')"
if [ "$DIST_FILE_COUNT" -eq 0 ]; then
    die "前端构建产物目录为空: $FRONTEND_DIST"
fi
log "前端产物: $FRONTEND_DIST (${DIST_FILE_COUNT} 个文件)"

# -----------------------------------------------------------------------------
# Go 交叉编译
# -----------------------------------------------------------------------------
ci_log "Go 交叉编译"
info "目标架构: ${TARGET_GOOS}/${TARGET_GOARCH} (鸿蒙 Linux 内核 + ARM64)"
info "构建标签: ${BUILD_TAGS} (Wails server 模式 + 生产模式, 无 CGO)"
info "版本号:   ${VERSION}"
info "产物名:   ${ARTIFACT_NAME}"
info "输出路径: ${ARTIFACT_PATH}"

# 确保输出目录存在
mkdir -p "$OUTPUT_DIR"

cd "$PROJECT_ROOT"

# 静态编译：CGO_ENABLED=0 + GOOS=linux + GOARCH=arm64
CGO_ENABLED=0 \
GOOS="$TARGET_GOOS" \
GOARCH="$TARGET_GOARCH" \
go build \
    -tags "$BUILD_TAGS" \
    -ldflags "-s -w -X main.Version=${VERSION}" \
    -o "$ARTIFACT_PATH" \
    .

ci_end

# -----------------------------------------------------------------------------
# 产物验证
# -----------------------------------------------------------------------------
ci_log "验证构建产物"

if [ ! -f "$ARTIFACT_PATH" ]; then
    die "编译完成但产出文件不存在: $ARTIFACT_PATH"
fi

# 获取文件大小
FILE_BYTES="$(stat -f%z "$ARTIFACT_PATH" 2>/dev/null || stat -c%s "$ARTIFACT_PATH" 2>/dev/null)"
if [ -z "$FILE_BYTES" ]; then
    die "无法获取产出文件大小"
fi

# 用 file 命令验证二进制格式
FILE_INFO="$(file "$ARTIFACT_PATH")"
info "file 信息: $FILE_INFO"

# 验证 ELF 格式
if ! printf '%s' "$FILE_INFO" | grep -qi "ELF"; then
    die "产出不是 ELF 格式: $FILE_INFO"
fi
# 验证 ARM64/aarch64 架构
if ! printf '%s' "$FILE_INFO" | grep -qiE "aarch64|ARM64"; then
    die "产出不是 ARM64 架构: $FILE_INFO"
fi
# 验证静态链接
if ! printf '%s' "$FILE_INFO" | grep -qi "statically linked"; then
    die "产出不是静态链接: $FILE_INFO"
fi

log "验证通过: ELF ARM64 静态链接二进制"
ci_end

# -----------------------------------------------------------------------------
# 产物信息输出与校验和
# -----------------------------------------------------------------------------
ci_log "产物信息"

# 计算 SHA256
SHA256="$(sha256sum "$ARTIFACT_PATH" | cut -d' ' -f1)"

info "产物名称:  ${ARTIFACT_NAME}"
info "产物路径:  ${ARTIFACT_PATH}"
info "文件大小:  $(human_size "$FILE_BYTES") ($FILE_BYTES 字节)"
info "SHA256:    ${SHA256}"

# 生成校验和文件 SHA256SUMS
# 格式: <sha256>  <filename>（仅文件名，不含目录前缀）
printf '%s  %s\n' "$SHA256" "$ARTIFACT_NAME" > "$CHECKSUM_FILE"
info "校验和文件: ${CHECKSUM_FILE}"

# 验证校验和
cd "$OUTPUT_DIR"
if sha256sum -c "$CHECKSUM_FILE" >/dev/null 2>&1; then
    info "校验和验证: 通过"
else
    die "校验和验证失败"
fi
cd "$PROJECT_ROOT"

ci_end

# -----------------------------------------------------------------------------
# 完成
# -----------------------------------------------------------------------------
log "鸿蒙 CI 构建完成"
info "产物: ${ARTIFACT_PATH}"
info "校验: ${CHECKSUM_FILE}"
info "可将 ${ARTIFACT_NAME} 拷贝至鸿蒙设备运行（ArkWeb 前端连 localhost:9245）"