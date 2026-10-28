#!/bin/bash
# ============================================================================
# HarmonyOS HAP 命令行签名脚本
# ============================================================================
# 用途: 对构建生成的 unsigned HAP 进行签名，生成可安装的 signed HAP
# 用法: ./sign.sh [debug|release]
#
# 背景:
#   hvigorw 的 signingConfigs 密码加密机制需要 DevEco Studio GUI 生成
#   sign/material 目录中的加密密钥文件，纯 CLI 环境无法复制。
#   本脚本使用 hap-sign-tool.jar sign-app 命令行签名作为替代方案。
#
# 前置条件:
#   1. 已执行 hmosBuild 构建生成 unsigned HAP
#   2. sign/ 目录下有完整的签名材料 (.p12/.cer/.p7b)
#
# 签名材料 (sign/ 目录):
#   uniterm.p12  - 应用密钥库 (EC P-256, SHA256withECDSA)
#   uniterm.cer  - 应用证书链 (由 OpenHarmony Application CA 签发)
#   uniterm.p7b  - 调试 Profile (bundle-name: com.aiops.terminal)
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SIGN_DIR="$PROJECT_DIR/sign"
HAP_SIGN_TOOL="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"

# 签名参数
KEY_ALIAS="uniterm_key"
KEY_PWD="UnitermSignPwd2026DebugAbcDef123"
SIGN_ALG="SHA256withECDSA"
COMPATIBLE_VERSION="26"

# 构建参数
MODE="${1:-debug}"
PRODUCT="default"

# 路径
UNSIGNED_HAP="$PROJECT_DIR/entry/build/$PRODUCT/outputs/default/entry-$PRODUCT-unsigned.hap"
SIGNED_HAP="$PROJECT_DIR/entry/build/$PRODUCT/outputs/default/entry-$PRODUCT-signed.hap"

echo "========================================"
echo " HarmonyOS HAP 签名脚本"
echo " 模式: $MODE | 产品: $PRODUCT"
echo "========================================"

# 检查签名材料
for f in "$SIGN_DIR/uniterm.p12" "$SIGN_DIR/uniterm.cer" "$SIGN_DIR/uniterm.p7b"; do
  if [ ! -f "$f" ]; then
    echo "错误: 签名材料缺失: $f"
    exit 1
  fi
done

# 检查 unsigned HAP
if [ ! -f "$UNSIGNED_HAP" ]; then
  echo "错误: 未找到 unsigned HAP: $UNSIGNED_HAP"
  echo "请先执行构建: hmosBuild (mode=$MODE, product=$PRODUCT)"
  exit 1
fi

echo "输入: $UNSIGNED_HAP ($(du -h "$UNSIGNED_HAP" | cut -f1))"
echo "签名中..."

# 执行签名
java -jar "$HAP_SIGN_TOOL" sign-app \
  -mode localSign \
  -keyAlias "$KEY_ALIAS" \
  -keyPwd "$KEY_PWD" \
  -appCertFile "$SIGN_DIR/uniterm.cer" \
  -profileFile "$SIGN_DIR/uniterm.p7b" \
  -inFile "$UNSIGNED_HAP" \
  -signAlg "$SIGN_ALG" \
  -keystoreFile "$SIGN_DIR/uniterm.p12" \
  -keystorePwd "$KEY_PWD" \
  -outFile "$SIGNED_HAP" \
  -compatibleVersion "$COMPATIBLE_VERSION" \
  -signCode "1" 2>&1 | grep -E "success|ERROR|Sign"

# 验证
if [ -f "$SIGNED_HAP" ]; then
  echo ""
  echo "========================================"
  echo " 签名成功!"
  echo "========================================"
  echo "输出: $SIGNED_HAP ($(du -h "$SIGNED_HAP" | cut -f1))"
  echo ""
  echo "安装到设备:"
  echo "  hdc install \"$SIGNED_HAP\""
  echo "========================================"
else
  echo "错误: 签名失败，signed HAP 未生成"
  exit 1
fi