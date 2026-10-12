/*
 * native_process.c - NDK 原生子进程管理
 *
 * 通过 fork + execve 启动 Go 二进制作为子进程，
 * 并通过 Node-API (NAPI) 导出供 ArkTS 调用。
 *
 * 编译方式（鸿蒙 NDK clang 交叉编译）:
 *   $OHOS_NDK/toolchains/llvm/bin/clang \
 *     --target=aarch64-linux-ohos \
 *     --sysroot=$OHOS_NDK/sysroot \
 *     -shared -fPIC \
 *     -I$OHOS_NDK/sysroot/usr/include \
 *     -o libnative_process.so \
 *     native_process.c
 *
 * 或在 DevEco Studio 中通过 CMakeLists.txt 自动编译：
 *   cmake_minimum_required(VERSION 3.5.0)
 *   project(native_process)
 *   add_library(native_process SHARED native_process.c)
 *   target_link_libraries(native_process PUBLIC libace_napi.z.so)
 *
 * 导出的 NAPI 方法:
 *   native_start(binaryPath, port)        → number (PID, >0 成功)
 *   native_stop(pid)                      → void
 *   native_is_running(pid)                → boolean
 *   native_chmod(path, mode)              → number (0 成功)
 *   native_is_executable(path)            → boolean
 *   native_wait_for_health(url, timeoutMs)→ boolean
 */

#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

#include <napi/native_api.h>

/* ========================================================================== */
/* 原生功能实现                                                                */
/* ========================================================================== */

/*
 * fork + execve 启动 Go 二进制子进程。
 *
 * 流程:
 *   1. fork() 创建子进程
 *   2. 子进程: 设置环境变量 AI_OPS_HOST / AI_OPS_PORT, 然后 execve 加载二进制
 *   3. 父进程: 返回子进程 PID
 *
 * 参数:
 *   binaryPath - Go 二进制完整路径（已赋予执行权限）
 *   port       - Go 后端监听端口
 *
 * 返回:
 *   >0  子进程 PID（成功）
 *   -1  fork 失败
 *   -2  execve 失败
 */
static int start_process(const char *binaryPath, int port)
{
    pid_t pid = fork();
    if (pid < 0) {
        /* fork 失败 */
        return -1;
    }

    if (pid == 0) {
        /* ---- 子进程 ---- */

        /* 设置环境变量 */
        char portStr[16];
        snprintf(portStr, sizeof(portStr), "%d", port);
        setenv("AI_OPS_HOST", "localhost", 1);
        setenv("AI_OPS_PORT", portStr, 1);

        /* 重定向 stdout/stderr 到日志文件（可选） */
        /* const char *logPath = "/data/storage/el2/base/files/ai-ops-terminal.log"; */
        /* int logFd = open(logPath, O_WRONLY | O_CREAT | O_APPEND, 0644); */
        /* if (logFd >= 0) { dup2(logFd, STDOUT_FILENO); dup2(logFd, STDERR_FILENO); close(logFd); } */

        /* execve 加载 Go 二进制 */
        char *argv[] = { (char *)binaryPath, NULL };
        char *envp[] = { NULL };  /* 使用 environ */

        execve(binaryPath, argv, envp);

        /* execve 仅在失败时返回 */
        /* 子进程退出，避免继续执行父进程代码 */
        _exit(127);
    }

    /* ---- 父进程 ---- */
    return (int)pid;
}

/*
 * 终止子进程。
 * 先发送 SIGTERM 优雅终止，等待 3 秒后若仍存活则发送 SIGKILL。
 */
static void stop_process(int pid)
{
    if (pid <= 0) {
        return;
    }

    /* 发送 SIGTERM */
    kill(pid, SIGTERM);

    /* 等待最多 3 秒 */
    for (int i = 0; i < 30; i++) {
        int status = 0;
        pid_t result = waitpid(pid, &status, WNOHANG);
        if (result == pid) {
            /* 子进程已退出 */
            return;
        }
        usleep(100000);  /* 100ms */
    }

    /* 超时，强制终止 */
    kill(pid, SIGKILL);
    waitpid(pid, NULL, 0);
}

/*
 * 检查子进程是否存活。
 * 返回: 1 存活, 0 已退出
 */
static int is_running(int pid)
{
    if (pid <= 0) {
        return 0;
    }
    /* kill(pid, 0) 不发送信号，仅检查进程是否存在 */
    return (kill(pid, 0) == 0) ? 1 : 0;
}

/*
 * 修改文件权限。
 * 返回: 0 成功, 非 0 为 errno
 */
static int do_chmod(const char *path, int mode)
{
    if (chmod(path, (mode_t)mode) != 0) {
        return errno;
    }
    return 0;
}

/*
 * 检查文件是否存在且可执行。
 * 返回: 1 可执行, 0 不可执行或不存在
 */
static int is_executable(const char *path)
{
    struct stat st;
    if (stat(path, &st) != 0) {
        return 0;
    }
    /* 检查是否为普通文件且有执行权限 */
    if (!S_ISREG(st.st_mode)) {
        return 0;
    }
    return (access(path, X_OK) == 0) ? 1 : 0;
}

/*
 * 健康检查：尝试 HTTP 连接到指定 URL。
 * 使用简单的 socket 连接判断端口是否可连。
 *
 * 参数:
 *   host     - 主机名（如 "localhost"）
 *   port     - 端口号
 *   timeoutMs- 超时时间（毫秒）
 *
 * 返回: 1 就绪, 0 未就绪
 */
static int wait_for_health(const char *host, int port, int timeoutMs)
{
    /* 简化实现：使用 socket connect 检测端口是否可连 */
    /* 完整实现应使用 HTTP GET 请求并检查响应状态码 */
    int sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd < 0) {
        return 0;
    }

    /* 设置超时 */
    struct timeval tv;
    tv.tv_sec = timeoutMs / 1000;
    tv.tv_usec = (timeoutMs % 1000) * 1000;
    setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sockfd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    /* 连接 */
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  /* 127.0.0.1 */

    int result = connect(sockfd, (struct sockaddr *)&addr, sizeof(addr));
    close(sockfd);

    return (result == 0) ? 1 : 0;
}

/* ========================================================================== */
/* NAPI 绑定层                                                                */
/* ========================================================================== */

/*
 * NAPI 方法: native_start(binaryPath, port) → number
 */
static napi_value NapiStart(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    /* 获取参数: binaryPath (string), port (number) */
    char binaryPath[512];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[0], binaryPath, sizeof(binaryPath), &pathLen);

    double port = 0;
    napi_get_value_double(env, args[1], &port);

    /* 调用原生功能 */
    int pid = start_process(binaryPath, (int)port);

    /* 返回 PID */
    napi_value result;
    napi_create_int32(env, pid, &result);
    return result;
}

/*
 * NAPI 方法: native_stop(pid) → void
 */
static napi_value NapiStop(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    int32_t pid = 0;
    napi_get_value_int32(env, args[0], &pid);

    stop_process(pid);

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/*
 * NAPI 方法: native_is_running(pid) → boolean
 */
static napi_value NapiIsRunning(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    int32_t pid = 0;
    napi_get_value_int32(env, args[0], &pid);

    napi_value result;
    napi_get_boolean(env, is_running(pid) != 0, &result);
    return result;
}

/*
 * NAPI 方法: native_chmod(path, mode) → number
 */
static napi_value NapiChmod(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    char path[512];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[0], path, sizeof(path), &pathLen);

    int32_t mode = 0;
    napi_get_value_int32(env, args[1], &mode);

    int err = do_chmod(path, mode);

    napi_value result;
    napi_create_int32(env, err, &result);
    return result;
}

/*
 * NAPI 方法: native_is_executable(path) → boolean
 */
static napi_value NapiIsExecutable(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    char path[512];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[0], path, sizeof(path), &pathLen);

    napi_value result;
    napi_get_boolean(env, is_executable(path) != 0, &result);
    return result;
}

/*
 * NAPI 方法: native_wait_for_health(url, timeoutMs) → boolean
 *
 * 注意: 此处简化实现，仅解析 URL 中的端口号并检测端口可连性。
 * 完整实现应使用 HTTP 客户端库发送 GET 请求。
 */
static napi_value NapiWaitForHealth(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    char url[512];
    size_t urlLen = 0;
    napi_get_value_string_utf8(env, args[0], url, sizeof(url), &urlLen);

    int32_t timeoutMs = 0;
    napi_get_value_int32(env, args[1], &timeoutMs);

    /* 简化: 从 URL 解析端口号 */
    /* URL 格式: http://localhost:9245/ */
    int port = 9245;  /* 默认端口 */
    char *portStart = strstr(url, ":");
    if (portStart != NULL) {
        /* 跳过 "http:" 中的第一个冒号，找第二个 */
        char *secondColon = strstr(portStart + 1, ":");
        if (secondColon != NULL) {
            port = atoi(secondColon + 1);
        }
    }

    int ready = wait_for_health("localhost", port, timeoutMs);

    napi_value result;
    napi_get_boolean(env, ready != 0, &result);
    return result;
}

/* ========================================================================== */
/* NAPI 模块注册                                                              */
/* ========================================================================== */

/*
 * 模块初始化：注册所有 NAPI 方法。
 */
EXTERN_C_START
static napi_value Init(napi_env env, napi_value exports)
{
    napi_property_descriptor descriptors[] = {
        { "native_start",          NULL, NapiStart,          NULL, NULL, NULL, napi_default, NULL },
        { "native_stop",           NULL, NapiStop,           NULL, NULL, NULL, napi_default, NULL },
        { "native_is_running",     NULL, NapiIsRunning,      NULL, NULL, NULL, napi_default, NULL },
        { "native_chmod",          NULL, NapiChmod,          NULL, NULL, NULL, napi_default, NULL },
        { "native_is_executable",  NULL, NapiIsExecutable,   NULL, NULL, NULL, napi_default, NULL },
        { "native_wait_for_health", NULL, NapiWaitForHealth, NULL, NULL, NULL, napi_default, NULL },
    };

    napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
    return exports;
}
EXTERN_C_END

/*
 * NAPI 模块描述。
 * 模块名 "native_process" 对应 libnative_process.so。
 */
static napi_module nativeProcessModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = NULL,
    .nm_register_func = Init,
    .nm_modname = "native_process",
    .nm_priv = ((void *)0),
    .reserved = { 0 },
};

/*
 * NAPI 模块注册入口。
 */
extern "C" __attribute__((visibility("default"))) void *RegisterModule(void)
{
    return (void *)&nativeProcessModule;
}