#!/bin/bash
# ============================================================================
# 生成 HarmonyOS 调试签名材料并签名 HAP
# ============================================================================
# 使用 hap-sign-tool.jar 生成完整的自签名调试证书链：
#   1. 应用密钥对 (uniterm.p12)
#   2. 根 CA
#   3. 应用签名中间 CA
#   4. 应用调试证书 (uniterm.cer)
#   5. Profile 密钥对
#   6. Profile 签名中间 CA
#   7. Profile 调试证书
#   8. 调试 Profile JSON → 签名 (uniterm.p7b)
#   9. 签名 HAP (entry-default-signed.hap)
# ============================================================================
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SIGN_DIR="$PROJECT_DIR/sign"
HAP_SIGN="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"

PWD_VAL="UnitermSignPwd2026DebugAbcDef123"
BUNDLE_NAME="com.aiops.terminal"
COMPATIBLE_VERSION="26"

UNSIGNED_HAP="$PROJECT_DIR/entry/build/default/outputs/default/entry-default-unsigned.hap"
SIGNED_HAP="$PROJECT_DIR/entry/build/default/outputs/default/entry-default-signed.hap"

SUBJECT_O="C=CN,O=OpenHarmony,OU=OpenHarmony Community"

mkdir -p "$SIGN_DIR"

run() { echo ">>> $*"; java -jar "$HAP_SIGN" "$@" 2>&1 | grep -vE "JAVA_TOOL_OPTIONS|^10-.*INFO - /\*|^10-.*INFO - \*|^10-.*INFO -$|Copyright|Licensed|WARRANTY|distributed|implied|See the|obtain|limitations|express or"; echo; }

echo "========================================"
echo " Step 1: 生成应用密钥对"
echo "========================================"
run generate-keypair -keyAlias "uniterm_key" -keyPwd "$PWD_VAL" \
  -keyAlg ECC -keySize NIST-P-256 \
  -keystoreFile "$SIGN_DIR/uniterm.p12" -keystorePwd "$PWD_VAL"

echo "========================================"
echo " Step 2: 生成根 CA"
echo "========================================"
run generate-ca -keyAlias "oh-root-ca-key" -keyPwd "$PWD_VAL" \
  -keyAlg RSA -keySize 2048 \
  -subject "$SUBJECT_O,CN=Root CA" \
  -validity 3650 -signAlg SHA384withECDSA \
  -keystoreFile "$SIGN_DIR/root-ca.p12" -keystorePwd "$PWD_VAL" \
  -outFile "$SIGN_DIR/root-ca.cer"

echo "========================================"
echo " Step 3: 生成应用签名中间 CA"
echo "========================================"
run generate-ca -keyAlias "oh-app-sign-srv-ca-key" -keyPwd "$PWD_VAL" \
  -keyAlg RSA -keySize 2048 \
  -issuer "$SUBJECT_O,CN=Root CA" \
  -issuerKeyAlias "oh-root-ca-key" -issuerKeyPwd "$PWD_VAL" \
  -subject "$SUBJECT_O,CN=Application Debug Signature Service CA" \
  -validity 3650 -signAlg SHA384withECDSA \
  -keystoreFile "$SIGN_DIR/root-ca.p12" -keystorePwd "$PWD_VAL" \
  -outFile "$SIGN_DIR/sub-app-sign-srv-ca.cer"

echo "========================================"
echo " Step 4: 生成应用调试证书 (certChain)"
echo "========================================"
run generate-app-cert -keyAlias "uniterm_key" -keyPwd "$PWD_VAL" \
  -issuer "$SUBJECT_O,CN=Application Debug Signature Service CA" \
  -issuerKeyAlias "oh-app-sign-srv-ca-key" -issuerKeyPwd "$PWD_VAL" \
  -issuerKeystoreFile "$SIGN_DIR/root-ca.p12" -issuerKeystorePwd "$PWD_VAL" \
  -subject "$SUBJECT_O,CN=uniterm Debug" \
  -validity 365 -signAlg SHA256withECDSA \
  -rootCaCertFile "$SIGN_DIR/root-ca.cer" \
  -subCaCertFile "$SIGN_DIR/sub-app-sign-srv-ca.cer" \
  -keystoreFile "$SIGN_DIR/uniterm.p12" -keystorePwd "$PWD_VAL" \
  -outForm certChain -outFile "$SIGN_DIR/uniterm.cer"

echo "========================================"
echo " Step 5: 生成 Profile 密钥对"
echo "========================================"
run generate-keypair -keyAlias "oh-profile-key" -keyPwd "$PWD_VAL" \
  -keyAlg RSA -keySize 2048 \
  -keystoreFile "$SIGN_DIR/profile-keypair.p12" -keystorePwd "$PWD_VAL"

echo "========================================"
echo " Step 6: 生成 Profile 签名中间 CA"
echo "========================================"
run generate-ca -keyAlias "oh-profile-sign-srv-ca-key" -keyPwd "$PWD_VAL" \
  -keyAlg RSA -keySize 2048 \
  -issuer "$SUBJECT_O,CN=Root CA" \
  -issuerKeyAlias "oh-root-ca-key" -issuerKeyPwd "$PWD_VAL" \
  -subject "$SUBJECT_O,CN=Provision Profile Debug Signature Service CA" \
  -validity 3650 -signAlg SHA384withECDSA \
  -keystoreFile "$SIGN_DIR/root-ca.p12" -keystorePwd "$PWD_VAL" \
  -outFile "$SIGN_DIR/sub-profile-sign-srv-ca.cer"

echo "========================================"
echo " Step 7: 生成 Profile 调试证书 (certChain)"
echo "========================================"
run generate-profile-cert -keyAlias "oh-profile-key" -keyPwd "$PWD_VAL" \
  -issuer "$SUBJECT_O,CN=Provision Profile Debug Signature Service CA" \
  -issuerKeyAlias "oh-profile-sign-srv-ca-key" -issuerKeyPwd "$PWD_VAL" \
  -issuerKeystoreFile "$SIGN_DIR/root-ca.p12" -issuerKeystorePwd "$PWD_VAL" \
  -subject "$SUBJECT_O,CN=Provision Profile Debug" \
  -validity 365 -signAlg SHA256withECDSA \
  -rootCaCertFile "$SIGN_DIR/root-ca.cer" \
  -subCaCertFile "$SIGN_DIR/sub-profile-sign-srv-ca.cer" \
  -keystoreFile "$SIGN_DIR/profile-keypair.p12" -keystorePwd "$PWD_VAL" \
  -outForm certChain -outFile "$SIGN_DIR/provision-profile-debug.cer"

echo "========================================"
echo " Step 8: 创建调试 Profile JSON 并签名"
echo "========================================"
cat > "$SIGN_DIR/uniterm-profile.json" <<'PROFEOF'
{
  "app-identifier": "com.aiops.terminal",
  "bundle-info": {
    "bundle-name": "com.aiops.terminal",
    "app-identifier": "com.aiops.terminal",
    "version-code": "1000000",
    "version-name": "1.0.0",
    "app-distribution-type": "debug"
  },
  "app-environment": "debug",
  "acls": {
    "associated-acls": []
  },
  "apis": {
    "optional-api-status": [],
    "restrict-api-status": []
  },
  "device-ids": [],
  "permissions": {
    "restricted-permissions": []
  },
  "profile-source": "manual",
  "type": "debug"
}
PROFEOF
echo "Profile JSON created: $SIGN_DIR/uniterm-profile.json"

run sign-profile -mode localSign \
  -keyAlias "oh-profile-key" -keyPwd "$PWD_VAL" \
  -profileCertFile "$SIGN_DIR/provision-profile-debug.cer" \
  -inFile "$SIGN_DIR/uniterm-profile.json" \
  -signAlg SHA256withECDSA \
  -keystoreFile "$SIGN_DIR/profile-keypair.p12" -keystorePwd "$PWD_VAL" \
  -outFile "$SIGN_DIR/uniterm.p7b"

echo "========================================"
echo " Step 9: 签名 HAP"
echo "========================================"
if [ ! -f "$UNSIGNED_HAP" ]; then
  echo "错误: 未找到 unsigned HAP: $UNSIGNED_HAP"
  exit 1
fi
echo "输入: $UNSIGNED_HAP ($(du -h "$UNSIGNED_HAP" | cut -f1))"

run sign-app -mode localSign \
  -keyAlias "uniterm_key" -keyPwd "$PWD_VAL" \
  -appCertFile "$SIGN_DIR/uniterm.cer" \
  -profileFile "$SIGN_DIR/uniterm.p7b" \
  -inFile "$UNSIGNED_HAP" \
  -signAlg SHA256withECDSA \
  -keystoreFile "$SIGN_DIR/uniterm.p12" -keystorePwd "$PWD_VAL" \
  -outFile "$SIGNED_HAP" \
  -compatibleVersion "$COMPATIBLE_VERSION" \
  -signCode "1"

echo ""
echo "========================================"
if [ -f "$SIGNED_HAP" ]; then
  echo " 签名成功!"
  echo "========================================"
  echo "输出: $SIGNED_HAP ($(du -h "$SIGNED_HAP" | cut -f1))"
  echo ""
  echo "签名材料:"
  ls -la "$SIGN_DIR"/uniterm.p12 "$SIGN_DIR"/uniterm.cer "$SIGN_DIR"/uniterm.p7b 2>&1
else
  echo " 签名失败!"
  echo "========================================"
  exit 1
fi