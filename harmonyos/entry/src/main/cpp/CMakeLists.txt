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

# 链接 HarmonyOS 系统库
# libace_napi.z.so  - Node-API 运行时
# libhilog_ndk.z.so - hilog 日志
# libaiops.so       - Go c-shared 共享库（暂时移除，测试 NAPI 模块是否能独立加载）
target_link_libraries(aiops_native
    libace_napi.z.so
    libhilog_ndk.z.so
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