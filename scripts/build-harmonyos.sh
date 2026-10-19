#!/bin/bash
set -euo pipefail

# 构建鸿蒙版 uniterm
# 用法: scripts/build-harmonyos.sh [--output <path>] [--version <ver>] [--skip-frontend]
# 产出: 静态链接 ELF ARM64 二进制，可在鸿蒙设备上运行
# 原理: Wails server 模式（-tags server）+ CGO_ENABLED=0 + GOOS=linux GOARCH=arm64
#
# 参数:
#   --output <path>      指定输出路径（默认: bin/uniterm-harmonyos）
#   --version <ver>      指定版本号（默认: 从 git tag 或 dev）
#   --skip-frontend      跳过前端构建（假设 frontend/dist 已存在）
#
# 示例:
#   scripts/build-harmonyos.sh
#   scripts/build-harmonyos.sh --output /tmp/test --version v1.0.0
#   scripts/build-harmonyos.sh --skip-frontend

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

DEFAULT_OUTPUT="bin/uniterm-harmonyos"

# -----------------------------------------------------------------------------
# 辅助函数
# -----------------------------------------------------------------------------
log()   { echo "==> $*"; }
info()  { echo "    $*"; }
warn()  { echo "WARN: $*" >&2; }
die()   { echo "ERROR: $*" >&2; exit 1; }

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

# 获取 git tag 版本号，失败时回退为 dev
resolve_version() {
    if [ -n "${OPT_VERSION:-}" ]; then
        printf '%s' "$OPT_VERSION"
        return
    fi
    local tag
    if tag="$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 2>/dev/null)"; then
        printf '%s' "$tag"
    else
        printf 'dev'
    fi
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

# -----------------------------------------------------------------------------
# 参数解析
# -----------------------------------------------------------------------------
OPT_OUTPUT=""
OPT_VERSION=""
OPT_SKIP_FRONTEND=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --output)
            [ "$#" -ge 2 ] || die "--output 需要一个参数"
            OPT_OUTPUT="$2"
            shift 2
            ;;
        --version)
            [ "$#" -ge 2 ] || die "--version 需要一个参数"
            OPT_VERSION="$2"
            shift 2
            ;;
        --skip-frontend)
            OPT_SKIP_FRONTEND=true
            shift
            ;;
        -h|--help)
            sed -n '2,20p' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        *)
            die "未知参数: $1（使用 -h 查看帮助）"
            ;;
    esac
done

OUTPUT_PATH="${OPT_OUTPUT:-$DEFAULT_OUTPUT}"
VERSION="$(resolve_version)"

# -----------------------------------------------------------------------------
# 环境检查
# -----------------------------------------------------------------------------
log "检查构建环境"

command -v go >/dev/null 2>&1 || die "未找到 go 命令，请先安装 Go >= ${MIN_GO_MAJOR}.${MIN_GO_MINOR}"

# 解析 Go 版本号: "go version go1.27.1 darwin/arm64" -> 1 27
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

# -----------------------------------------------------------------------------
# 前端构建
# -----------------------------------------------------------------------------
if [ "$OPT_SKIP_FRONTEND" = "false" ]; then
    log "构建前端 (frontend/dist)"
    (
        cd "$PROJECT_ROOT/frontend"
        command -v npm >/dev/null 2>&1 || die "未找到 npm 命令"
        npm run build
    )
else
    info "跳过前端构建 (--skip-frontend)"
fi

# 检查 frontend/dist 是否存在
FRONTEND_DIST="$PROJECT_ROOT/frontend/dist"
if [ ! -d "$FRONTEND_DIST" ]; then
    die "前端构建产物目录不存在: $FRONTEND_DIST（请去掉 --skip-frontend 重新构建）"
fi
DIST_FILE_COUNT="$(find "$FRONTEND_DIST" -type f | wc -l | tr -d ' ')"
if [ "$DIST_FILE_COUNT" -eq 0 ]; then
    die "前端构建产物目录为空: $FRONTEND_DIST"
fi
info "前端产物: $FRONTEND_DIST (${DIST_FILE_COUNT} 个文件)"

# -----------------------------------------------------------------------------
# Go 交叉编译
# -----------------------------------------------------------------------------
log "开始 Go 交叉编译"
info "目标架构: ${TARGET_GOOS}/${TARGET_GOARCH} (鸿蒙 Linux 内核 + ARM64)"
info "构建标签: ${BUILD_TAGS} (Wails server 模式 + 生产 asset server, 无 CGO)"
info "版本号:   ${VERSION}"
info "输出路径: ${OUTPUT_PATH}"

# 确保输出目录存在
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
if [ "$OUTPUT_DIR" != "." ] && [ ! -d "$OUTPUT_DIR" ]; then
    mkdir -p "$OUTPUT_DIR"
fi

cd "$PROJECT_ROOT"

# shellcheck disable=SC2086
CGO_ENABLED=0 \
GOOS="$TARGET_GOOS" \
GOARCH="$TARGET_GOARCH" \
go build \
    -tags "$BUILD_TAGS" \
    -ldflags "-s -w -X main.Version=${VERSION}" \
    -o "$OUTPUT_PATH" \
    .

# -----------------------------------------------------------------------------
# 验证产出
# -----------------------------------------------------------------------------
if [ ! -f "$OUTPUT_PATH" ]; then
    die "编译完成但产出文件不存在: $OUTPUT_PATH"
fi

FILE_BYTES="$(stat -f%z "$OUTPUT_PATH" 2>/dev/null || stat -c%s "$OUTPUT_PATH" 2>/dev/null)"
if [ -z "$FILE_BYTES" ]; then
    die "无法获取产出文件大小"
fi

log "编译完成"
info "文件大小: $(human_size "$FILE_BYTES") ($FILE_BYTES 字节)"

# 用 file 命令验证二进制格式
command -v file >/dev/null 2>&1 || die "未找到 file 命令，无法验证二进制格式"
FILE_INFO="$(file "$OUTPUT_PATH")"
info "file 信息: $FILE_INFO"

# 验证是 ELF 格式
if ! printf '%s' "$FILE_INFO" | grep -qi "ELF"; then
    die "产出不是 ELF 格式: $FILE_INFO"
fi
# 验证是 ARM64/aarch64 架构
if ! printf '%s' "$FILE_INFO" | grep -qiE "aarch64|ARM64"; then
    die "产出不是 ARM64 架构: $FILE_INFO"
fi
# 验证是静态链接
if ! printf '%s' "$FILE_INFO" | grep -qi "statically linked"; then
    die "产出不是静态链接: $FILE_INFO"
fi

log "验证通过: ELF ARM64 静态链接二进制"
info "可将 $OUTPUT_PATH 拷贝至鸿蒙设备运行"