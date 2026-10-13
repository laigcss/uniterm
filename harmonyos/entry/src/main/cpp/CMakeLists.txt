# CMakeLists.txt - native_process NDK 库构建配置
#
# 编译 native_process.c 为 libnative_process.so，
# 供 ArkTS 通过 Node-API (NAPI) 调用，实现 Go 子进程管理。
#
# 功能：fork + execve 启动子进程、SIGTERM/SIGKILL 终止、
#       chmod、健康检查轮询、进程信息读取。

cmake_minimum_required(VERSION 3.5.0)
project(native_process)

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

# 构建共享库 libnative_process.so
add_library(native_process SHARED ${NATIVE_SOURCE})

# 链接 HarmonyOS 系统库
# libace_napi.z.so  - Node-API 运行时
# libhilog_ndk.z.so - hilog 日志
target_link_libraries(native_process
    libace_napi.z.so
    libhilog_ndk.z.so
)

# 包含目录
target_include_directories(native_process
    PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# 设置输出目录到 libs/<arch>
set_target_properties(native_process PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../libs/${OHOS_ARCH}
)