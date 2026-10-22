# CMakeLists.txt - native_process NDK 库构建配置
#
# 编译 native_process.c 为 libnative_process.so，
# 供 ArkTS 通过 Node-API (NAPI) 调用，实现 Go 子进程管理。
#
# 功能：fork + execve 启动子进程、SIGTERM/SIGKILL 终止、
#       chmod、健康检查轮询、进程信息读取。

cmake_minimum_required(VERSION 3.5.0)
project(aiops_native)

# 设置 C 标准
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

# 基础编译选项：位置无关代码、隐藏符号可见性、警告
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fPIC -fvisibility=hidden -Wall")

# 根据构建类型设置优化级别
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O2 -DNDEBUG")
else()
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O0 -g -DDEBUG")
endif()

# 源文件列表
set(NATIVE_SOURCE
    native_process.c
)

# 构建共享库 libaiops_native.so
add_library(aiops_native SHARED ${NATIVE_SOURCE})

# Go c-shared 共享库目录（libaiops.so 所在位置）
set(GO_LIB_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../libs/${OHOS_ARCH})

# 添加链接搜索路径（让链接器能找到 libaiops.so）
link_directories(${GO_LIB_DIR})

# 链接 HarmonyOS 系统库 + Go c-shared 库
# libace_napi.z.so  - Node-API 运行时
# libhilog_ndk.z.so - hilog 日志
# libaiops.so       - Go c-shared 库（Wails server 模式）
#
# libaiops.so 包含完整的 Go Wails server（终端/SSH/k8s/容器等后端），
# 通过弱符号 StartServer/SetDataDirRoot 供 NAPI 调用。
# Go runtime 在 libaiops_native.so 被 dlopen 加载时自动初始化。
#
# 前提条件：
#   1. libaiops.so 必须用 GOOS=android 编译（避免 TLS initial-exec 重定位问题）
#   2. Go 安装中的 gcc_android.c 必须包含 tls_g=0 修复
#   3. 构建标签: -tags server,cshared
target_link_libraries(aiops_native
    libace_napi.z.so
    libhilog_ndk.z.so
    ${GO_LIB_DIR}/libaiops.so
)

# 包含目录
target_include_directories(aiops_native
    PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}

)

# 设置输出目录到 libs/<arch>
set_target_properties(aiops_native PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../libs/${OHOS_ARCH}
)