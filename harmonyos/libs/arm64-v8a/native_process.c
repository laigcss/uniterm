/*
 * native_process.c - NDK 原生子进程管理（完整实现）
 *
 * 通过 fork + execve 启动 Go 二进制作为子进程，
 * 并通过 Node-API (NAPI) 导出供 ArkTS 调用。
 *
 * 功能清单:
 *   1. fork + execve 启动子进程（继承环境变量，覆盖 AI_OPS_HOST/AI_OPS_PORT）
 *   2. stdout/stderr 管道捕获 → 异步线程写入日志文件
 *   3. 崩溃检测自动重启（独立线程监控，最多 3 次，间隔 1 秒）
 *   4. 完整 HTTP GET 健康检查（发送请求，检查 200 状态码）
 *   5. 进程资源使用（/proc/[pid]/status 读取 VmRSS，/proc/[pid]/stat 计算 CPU）
 *   6. SIGCHLD 信号处理（回收僵尸进程）+ SIGPIPE 忽略
 *   7. SIGTERM/SIGKILL 终止、进程状态检查、chmod/isExecutable
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
 * 或在 DevEco Studio 中通过 CMakeLists.txt 自动编译。
 *
 * 导出的 NAPI 方法:
 *   native_start(binaryPath, port)         → number (PID, >0 成功)
 *   native_stop(pid)                       → void
 *   native_is_running(pid)                 → boolean
 *   native_chmod(path, mode)               → number (0 成功)
 *   native_is_executable(path)             → boolean
 *   native_wait_for_health(url, timeoutMs) → boolean
 *   native_get_process_info(pid)           → object { pid, memoryKb, cpuPercent, isRunning, exitCode }
 *   native_watch_process(pid, binaryPath, port) → number (0 成功)
 *   native_stop_watch()                    → void
 *   native_init_signals()                  → void
 */

/* 系统头文件 */
#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <stdio.h>
#include <time.h>
#include <pthread.h>

/* 本项目头文件 */
#include "native_process.h"

/* NAPI 头文件 */
#include <napi/native_api.h>

/* musl libc 的环境变量指针（继承当前环境） */
extern char **environ;

/* ========================================================================== */
/* 全局状态                                                                    */
/* ========================================================================== */

/*
 * 进程监控上下文。
 * 用于崩溃自动重启的独立线程管理。
 */
static struct {
    volatile pid_t pid;                     /* 当前监控的子进程 PID */
    char binaryPath[MAX_PATH_LEN];          /* Go 二进制路径（重启时使用） */
    int port;                               /* 监听端口（重启时使用） */
    volatile int restartCount;              /* 已重启次数 */
    volatile sig_atomic_t shouldStop;       /* 停止标志（1=停止监控） */
    volatile sig_atomic_t watchActive;      /* 监控线程是否活跃 */
    pthread_t watchThread;                  /* 监控线程句柄 */
} g_watchCtx = {
    .pid = -1,
    .restartCount = 0,
    .shouldStop = 0,
    .watchActive = 0,
};

/* SIGCHLD 信号标志（异步信号安全） */
static volatile sig_atomic_t g_sigchldFlag = 0;

/* ========================================================================== */
/* 内部辅助函数                                                                */
/* ========================================================================== */

/*
 * 日志线程参数。
 * 由 start_process 传递给日志读取线程。
 */
typedef struct {
    int fd;                                 /* 管道读端文件描述符 */
    char logPath[MAX_PATH_LEN];             /* 日志文件路径 */
} LogThreadArg;

/*
 * 日志读取线程函数。
 * 从管道读端持续读取子进程 stdout/stderr 输出，写入日志文件。
 * 当子进程退出关闭管道写端时，read 返回 0（EOF），线程自动退出。
 *
 * 参数:
 *   arg - LogThreadArg 指针（调用方 malloc，本函数负责 free）
 */
static void *log_thread_func(void *arg)
{
    LogThreadArg *logArg = (LogThreadArg *)arg;
    if (logArg == NULL) {
        return NULL;
    }

    /* 打开日志文件（追加写入） */
    int logFd = open(logArg->logPath, O_WRONLY | O_CREAT | O_APPEND, 0644);

    /* 写入分隔行，标记新会话开始 */
    if (logFd >= 0) {
        const char *sep = "\n===== 子进程输出开始 =====\n";
        write(logFd, sep, strlen(sep));
    }

    /* 持续读取管道数据并写入日志文件 */
    char buf[LOG_READ_BUFFER];
    ssize_t n;
    while ((n = read(logArg->fd, buf, sizeof(buf))) > 0) {
        if (logFd >= 0) {
            write(logFd, buf, (size_t)n);
        }
    }

    /* 清理 */
    if (logFd >= 0) {
        close(logFd);
    }
    close(logArg->fd);
    free(logArg);
    return NULL;
}

/*
 * 从 /proc/[pid]/stat 读取 CPU 时间（utime + stime，单位：时钟滴答）。
 *
 * /proc/[pid]/stat 格式（关键字段）:
 *   pid (comm) state ppid pgrp session tty_nr tpgid flags
 *   minflt cminflt majflt cmajflt utime stime ...
 *
 * comm 字段可能包含空格和括号，因此用 strrchr 找最后一个 ')' 来定位。
 * utime 和 stime 是 ')' 后的第 12、13 个字段。
 *
 * 返回: utime + stime（成功），-1（失败）
 */
static long read_cpu_time(int pid)
{
    char path[64];
    snprintf(path, sizeof(path), "/proc/%d/stat", pid);

    FILE *f = fopen(path, "r");
    if (f == NULL) {
        return -1;
    }

    char buf[2048];
    if (fgets(buf, sizeof(buf), f) == NULL) {
        fclose(f);
        return -1;
    }
    fclose(f);

    /* 找到最后一个 ')'，跳过 comm 字段 */
    char *p = strrchr(buf, ')');
    if (p == NULL) {
        return -1;
    }
    p++;

    /* 跳过 ')' 后的前 11 个字段（state ~ cmajflt） */
    for (int i = 0; i < 11; i++) {
        while (*p == ' ') {
            p++;
        }
        while (*p != '\0' && *p != ' ') {
            p++;
        }
    }

    /* 读取 utime（第 12 个字段）和 stime（第 13 个字段） */
    long utime = 0;
    long stime = 0;
    while (*p == ' ') {
        p++;
    }
    utime = strtol(p, &p, 10);
    while (*p == ' ') {
        p++;
    }
    stime = strtol(p, NULL, 10);

    return utime + stime;
}

/*
 * SIGCHLD 信号处理函数。
 * 设置标志位，由监控线程或 stop_process 负责实际回收。
 * 仅使用异步信号安全操作。
 */
static void sigchld_handler(int signo)
{
    (void)signo;
    g_sigchldFlag = 1;

    /*
     * 非阻塞回收所有已退出的子进程，避免僵尸进程。
     * waitpid(-1, NULL, WNOHANG) 是异步信号安全的。
     * 注意：此处不保存退出状态，监控线程通过 kill(pid, 0) 检测进程是否存活。
     */
    while (waitpid(-1, NULL, WNOHANG) > 0) {
        /* 循环回收所有已退出的子进程 */
    }
}

/*
 * 监控线程函数。
 * 轮询检测子进程是否存活，若异常退出且未达到最大重启次数则自动重启。
 */
static void *watch_thread_func(void *arg)
{
    (void)arg;
    pid_t currentPid = g_watchCtx.pid;

    while (!g_watchCtx.shouldStop) {
        /* 用 kill(pid, 0) 检测子进程是否存活 */
        if (kill(currentPid, 0) != 0) {
            /* 子进程已退出 */
            if (g_watchCtx.shouldStop) {
                /* 正常停止，不重启 */
                break;
            }

            /* 异常退出，尝试重启 */
            if (g_watchCtx.restartCount < MAX_RESTART_COUNT) {
                g_watchCtx.restartCount++;

                /* 等待重启间隔 */
                usleep(RESTART_INTERVAL_MS * 1000);

                /* 再次检查停止标志（可能在等待期间收到停止请求） */
                if (g_watchCtx.shouldStop) {
                    break;
                }

                /* 重启子进程 */
                currentPid = start_process(g_watchCtx.binaryPath, g_watchCtx.port);
                g_watchCtx.pid = currentPid;

                if (currentPid <= 0) {
                    /* 重启失败，退出监控 */
                    break;
                }
            } else {
                /* 达到最大重启次数，退出监控 */
                break;
            }
        }

        /* 轮询间隔 */
        usleep(WATCH_POLL_INTERVAL_MS * 1000);
    }

    g_watchCtx.watchActive = 0;
    return NULL;
}

/* ========================================================================== */
/* 公开功能实现                                                                */
/* ========================================================================== */

/*
 * fork + execve 启动 Go 二进制子进程。
 *
 * 流程:
 *   1. 创建管道（pipe）用于捕获 stdout/stderr
 *   2. fork() 创建子进程
 *   3. 子进程: dup2 重定向 stdout/stderr 到管道写端，继承环境变量并覆盖
 *      AI_OPS_HOST / AI_OPS_PORT，然后 execve 加载二进制
 *   4. 父进程: 启动异步线程从管道读端读取数据写入日志文件，返回子进程 PID
 */
int start_process(const char *binaryPath, int port)
{
    /* 创建管道用于捕获子进程 stdout/stderr */
    int pipefd[2];
    if (pipe(pipefd) != 0) {
        return -3;  /* 管道创建失败 */
    }

    pid_t pid = fork();
    if (pid < 0) {
        /* fork 失败，关闭管道 */
        close(pipefd[0]);
        close(pipefd[1]);
        return -1;
    }

    if (pid == 0) {
        /* ---- 子进程 ---- */

        /* 关闭管道读端 */
        close(pipefd[0]);

        /* 重定向 stdout/stderr 到管道写端 */
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);

        /* 设置环境变量：继承当前环境，覆盖 AI_OPS_HOST / AI_OPS_PORT */
        char portStr[16];
        snprintf(portStr, sizeof(portStr), "%d", port);
        setenv("AI_OPS_HOST", "localhost", 1);
        setenv("AI_OPS_PORT", portStr, 1);

        /* execve 加载 Go 二进制，传递 environ（继承当前环境变量） */
        char *argv[] = { (char *)binaryPath, NULL };
        execve(binaryPath, argv, environ);

        /* execve 仅在失败时返回 */
        _exit(127);
    }

    /* ---- 父进程 ---- */

    /* 关闭管道写端 */
    close(pipefd[1]);

    /* 启动异步线程从管道读端读取数据并写入日志文件 */
    LogThreadArg *logArg = (LogThreadArg *)malloc(sizeof(LogThreadArg));
    if (logArg != NULL) {
        logArg->fd = pipefd[0];
        strncpy(logArg->logPath, DEFAULT_LOG_PATH, sizeof(logArg->logPath) - 1);
        logArg->logPath[sizeof(logArg->logPath) - 1] = '\0';

        pthread_t logThread;
        if (pthread_create(&logThread, NULL, log_thread_func, logArg) == 0) {
            /* 分离线程，结束时自动回收资源 */
            pthread_detach(logThread);
        } else {
            /* 线程创建失败，关闭读端（子进程输出将丢失但不影响运行） */
            close(pipefd[0]);
            free(logArg);
        }
    } else {
        /* malloc 失败，关闭读端 */
        close(pipefd[0]);
    }

    return (int)pid;
}

/*
 * 终止子进程。
 * 先发送 SIGTERM 优雅终止，等待 GRACEFUL_STOP_TIMEOUT_MS 后若仍存活则发送 SIGKILL。
 */
void stop_process(int pid)
{
    if (pid <= 0) {
        return;
    }

    /* 发送 SIGTERM */
    kill(pid, SIGTERM);

    /* 轮询等待子进程退出，最多等待 GRACEFUL_STOP_TIMEOUT_MS */
    int pollCount = GRACEFUL_STOP_TIMEOUT_MS / 100;
    for (int i = 0; i < pollCount; i++) {
        if (kill(pid, 0) != 0) {
            /* 子进程已退出（SIGCHLD 处理函数会回收） */
            return;
        }
        usleep(100000);  /* 100ms */
    }

    /* 超时，强制终止 */
    kill(pid, SIGKILL);

    /* 确保回收（WNOHANG 非阻塞，若已被 SIGCHLD 处理函数回收则返回 -1） */
    waitpid(pid, NULL, WNOHANG);
}

/*
 * 检查子进程是否存活。
 * 返回: 1 存活, 0 已退出
 */
int is_running(int pid)
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
int do_chmod(const char *path, int mode)
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
int is_executable(const char *path)
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
 * HTTP 健康检查。
 * 发送完整的 HTTP GET 请求 "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n"，
 * 读取响应并检查状态码是否为 200。
 *
 * 返回: 1 就绪（HTTP 200）, 0 未就绪
 */
int wait_for_health(const char *host, int port, int timeoutMs)
{
    int sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd < 0) {
        return 0;
    }

    /* 设置发送/接收超时 */
    struct timeval tv;
    tv.tv_sec = timeoutMs / 1000;
    tv.tv_usec = (timeoutMs % 1000) * 1000;
    setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sockfd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    /* 连接服务器 */
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)port);

    /* 解析主机名（支持 "localhost" 和 IP 地址） */
    if (strcmp(host, "localhost") == 0) {
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  /* 127.0.0.1 */
    } else {
        if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
            /* 主机名解析失败，默认使用回环地址 */
            addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        }
    }

    if (connect(sockfd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(sockfd);
        return 0;
    }

    /* 发送完整的 HTTP GET 请求 */
    const char *request = "GET " HEALTH_CHECK_PATH " HTTP/1.0\r\n"
                          "Host: localhost\r\n"
                          "\r\n";
    ssize_t reqLen = (ssize_t)strlen(request);
    if (write(sockfd, request, (size_t)reqLen) != reqLen) {
        close(sockfd);
        return 0;
    }

    /* 读取 HTTP 响应 */
    char response[HEALTH_RESPONSE_BUFFER];
    ssize_t respLen = read(sockfd, response, sizeof(response) - 1);
    close(sockfd);

    if (respLen <= 0) {
        return 0;
    }
    response[respLen] = '\0';

    /* 检查 HTTP 状态码是否为 200 */
    /* 响应格式: "HTTP/1.0 200 OK\r\n..." */
    if (strncmp(response, "HTTP/", 5) == 0) {
        /* 跳过 "HTTP/x.x " 找到状态码 */
        char *statusStart = strchr(response, ' ');
        if (statusStart != NULL) {
            statusStart++;  /* 跳过空格 */
            if (strncmp(statusStart, "200", 3) == 0) {
                return 1;  /* HTTP 200，服务就绪 */
            }
        }
    }

    return 0;  /* 非 200 或格式错误 */
}

/*
 * 获取进程资源使用信息。
 * 通过 /proc/[pid]/status 读取 VmRSS（物理内存），
 * 通过 /proc/[pid]/stat 两次采样计算 CPU 使用率。
 */
int get_process_info(int pid, ProcessInfo *info)
{
    if (info == NULL) {
        return -1;
    }

    memset(info, 0, sizeof(ProcessInfo));
    info->pid = pid;
    info->is_running = is_running(pid);
    info->exit_code = -1;  /* 默认未知 */

    if (!info->is_running) {
        /* 进程未运行，返回基本信息 */
        return 0;
    }

    /* ---- 读取 VmRSS（物理内存使用）---- */
    char path[64];
    snprintf(path, sizeof(path), "/proc/%d/status", pid);
    FILE *f = fopen(path, "r");
    if (f != NULL) {
        char line[256];
        while (fgets(line, sizeof(line), f) != NULL) {
            /* 查找 "VmRSS:" 行，格式: "VmRSS:    12345 kB" */
            if (strncmp(line, "VmRSS:", 6) == 0) {
                sscanf(line + 6, " %ld kB", &info->memory_kb);
                break;
            }
        }
        fclose(f);
    }

    /* ---- 计算 CPU 使用率（两次采样）---- */
    long clkTck = sysconf(_SC_CLK_TCK);
    if (clkTck <= 0) {
        clkTck = 100;  /* 默认值 */
    }

    /* 第一次采样：CPU 时间 + 当前时间 */
    long cpuTime1 = read_cpu_time(pid);
    struct timespec ts1;
    clock_gettime(CLOCK_MONOTONIC, &ts1);

    /* 采样间隔 */
    usleep(CPU_SAMPLE_INTERVAL_MS * 1000);

    /* 第二次采样 */
    long cpuTime2 = read_cpu_time(pid);
    struct timespec ts2;
    clock_gettime(CLOCK_MONOTONIC, &ts2);

    if (cpuTime1 >= 0 && cpuTime2 >= 0) {
        /* 计算实际经过的时间（毫秒） */
        double elapsedMs = (double)(ts2.tv_sec - ts1.tv_sec) * 1000.0
                         + (double)(ts2.tv_nsec - ts1.tv_nsec) / 1000000.0;

        if (elapsedMs > 0) {
            /* CPU 使用时间增量（毫秒） */
            double cpuDeltaMs = (double)(cpuTime2 - cpuTime1) * 1000.0 / (double)clkTck;
            /* CPU 使用率 = CPU 时间增量 / 实际时间增量 × 100 */
            info->cpu_percent = (cpuDeltaMs / elapsedMs) * 100.0;
            if (info->cpu_percent < 0) {
                info->cpu_percent = 0;
            }
        }
    }

    return 0;
}

/*
 * 启动进程监控（崩溃自动重启）。
 * 在独立线程中监控子进程状态，若异常退出则自动重启。
 */
int watch_process(int pid, const char *binaryPath, int port)
{
    if (pid <= 0 || binaryPath == NULL) {
        return -1;
    }

    /* 如果已有监控线程在运行，先停止 */
    if (g_watchCtx.watchActive) {
        stop_watch();
    }

    /* 初始化监控上下文 */
    g_watchCtx.pid = pid;
    strncpy(g_watchCtx.binaryPath, binaryPath, sizeof(g_watchCtx.binaryPath) - 1);
    g_watchCtx.binaryPath[sizeof(g_watchCtx.binaryPath) - 1] = '\0';
    g_watchCtx.port = port;
    g_watchCtx.restartCount = 0;
    g_watchCtx.shouldStop = 0;
    g_watchCtx.watchActive = 1;

    /* 启动监控线程 */
    if (pthread_create(&g_watchCtx.watchThread, NULL, watch_thread_func, NULL) != 0) {
        g_watchCtx.watchActive = 0;
        return -1;
    }

    /* 分离线程，结束时自动回收 */
    pthread_detach(g_watchCtx.watchThread);
    return 0;
}

/*
 * 停止进程监控。
 * 设置停止标志，监控线程将在下一次轮询时退出，不再自动重启。
 */
void stop_watch(void)
{
    if (!g_watchCtx.watchActive) {
        return;
    }

    /* 设置停止标志 */
    g_watchCtx.shouldStop = 1;

    /*
     * 监控线程在最多 WATCH_POLL_INTERVAL_MS 内检测到标志并退出。
     * 线程已 detach，无需 join。
     * 等待一小段时间确保线程退出。
     */
    usleep((WATCH_POLL_INTERVAL_MS + 50) * 1000);

    g_watchCtx.watchActive = 0;
    g_watchCtx.pid = -1;
}

/*
 * 初始化信号处理。
 * 注册 SIGCHLD 处理函数（回收僵尸进程）并忽略 SIGPIPE（避免管道写入导致进程退出）。
 */
void init_signal_handlers(void)
{
    struct sigaction sa;

    /* 注册 SIGCHLD 处理函数 */
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = sigchld_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESTART | SA_NOCLDSTOP;
    sigaction(SIGCHLD, &sa, NULL);

    /* 忽略 SIGPIPE（避免写已关闭管道导致进程退出） */
    signal(SIGPIPE, SIG_IGN);
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
    char binaryPath[MAX_PATH_LEN];
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

    char path[MAX_PATH_LEN];
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

    char path[MAX_PATH_LEN];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[0], path, sizeof(path), &pathLen);

    napi_value result;
    napi_get_boolean(env, is_executable(path) != 0, &result);
    return result;
}

/*
 * NAPI 方法: native_wait_for_health(url, timeoutMs) → boolean
 *
 * 从 URL 中解析主机和端口，发送完整 HTTP GET 请求并检查 200 状态码。
 */
static napi_value NapiWaitForHealth(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    char url[MAX_PATH_LEN];
    size_t urlLen = 0;
    napi_get_value_string_utf8(env, args[0], url, sizeof(url), &urlLen);

    int32_t timeoutMs = 0;
    napi_get_value_int32(env, args[1], &timeoutMs);

    /* 解析 URL: http://host:port/path → 提取 host 和 port */
    char host[128] = "localhost";
    int port = DEFAULT_PORT;

    /* 跳过 "http://" 或 "https://" 前缀 */
    char *p = url;
    if (strncmp(p, "http://", 7) == 0) {
        p += 7;
    } else if (strncmp(p, "https://", 8) == 0) {
        p += 8;
    }

    /* 提取主机名（到 ':' 或 '/' 或 '\0' 为止） */
    char *colon = strchr(p, ':');
    char *slash = strchr(p, '/');
    char *hostEnd = NULL;
    if (colon != NULL && (slash == NULL || colon < slash)) {
        hostEnd = colon;
        port = atoi(colon + 1);
    } else if (slash != NULL) {
        hostEnd = slash;
    } else {
        hostEnd = p + strlen(p);
    }

    if (hostEnd > p) {
        size_t hostLen = (size_t)(hostEnd - p);
        if (hostLen >= sizeof(host)) {
            hostLen = sizeof(host) - 1;
        }
        strncpy(host, p, hostLen);
        host[hostLen] = '\0';
    }

    int ready = wait_for_health(host, port, timeoutMs);

    napi_value result;
    napi_get_boolean(env, ready != 0, &result);
    return result;
}

/*
 * NAPI 方法: native_get_process_info(pid) → object
 * 返回 { pid, memoryKb, cpuPercent, isRunning, exitCode }
 */
static napi_value NapiGetProcessInfo(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    int32_t pid = 0;
    napi_get_value_int32(env, args[0], &pid);

    /* 调用原生功能获取进程信息 */
    ProcessInfo pinfo;
    get_process_info(pid, &pinfo);

    /* 构建返回对象 */
    napi_value result;
    napi_create_object(env, &result);

    napi_value val;

    /* pid */
    napi_create_int32(env, pinfo.pid, &val);
    napi_set_named_property(env, result, "pid", val);

    /* memoryKb */
    napi_create_int64(env, (int64_t)pinfo.memory_kb, &val);
    napi_set_named_property(env, result, "memoryKb", val);

    /* cpuPercent */
    napi_create_double(env, pinfo.cpu_percent, &val);
    napi_set_named_property(env, result, "cpuPercent", val);

    /* isRunning */
    napi_get_boolean(env, pinfo.is_running != 0, &val);
    napi_set_named_property(env, result, "isRunning", val);

    /* exitCode */
    napi_create_int32(env, pinfo.exit_code, &val);
    napi_set_named_property(env, result, "exitCode", val);

    return result;
}

/*
 * NAPI 方法: native_watch_process(pid, binaryPath, port) → number
 * 启动崩溃自动重启监控。
 */
static napi_value NapiWatchProcess(napi_env env, napi_callback_info info)
{
    size_t argc = 3;
    napi_value args[3];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    int32_t pid = 0;
    napi_get_value_int32(env, args[0], &pid);

    char binaryPath[MAX_PATH_LEN];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[1], binaryPath, sizeof(binaryPath), &pathLen);

    double port = 0;
    napi_get_value_double(env, args[2], &port);

    int ret = watch_process(pid, binaryPath, (int)port);

    napi_value result;
    napi_create_int32(env, ret, &result);
    return result;
}

/*
 * NAPI 方法: native_stop_watch() → void
 * 停止崩溃自动重启监控。
 */
static napi_value NapiStopWatch(napi_env env, napi_callback_info info)
{
    (void)env;
    (void)info;

    stop_watch();

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/*
 * NAPI 方法: native_init_signals() → void
 * 初始化信号处理（SIGCHLD 回收僵尸进程，SIGPIPE 忽略）。
 */
static napi_value NapiInitSignals(napi_env env, napi_callback_info info)
{
    (void)env;
    (void)info;

    init_signal_handlers();

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
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
        { "native_start",           NULL, NapiStart,           NULL, NULL, NULL, napi_default, NULL },
        { "native_stop",            NULL, NapiStop,            NULL, NULL, NULL, napi_default, NULL },
        { "native_is_running",      NULL, NapiIsRunning,       NULL, NULL, NULL, napi_default, NULL },
        { "native_chmod",           NULL, NapiChmod,           NULL, NULL, NULL, napi_default, NULL },
        { "native_is_executable",   NULL, NapiIsExecutable,    NULL, NULL, NULL, napi_default, NULL },
        { "native_wait_for_health", NULL, NapiWaitForHealth,   NULL, NULL, NULL, napi_default, NULL },
        { "native_get_process_info",NULL, NapiGetProcessInfo,  NULL, NULL, NULL, napi_default, NULL },
        { "native_watch_process",   NULL, NapiWatchProcess,    NULL, NULL, NULL, napi_default, NULL },
        { "native_stop_watch",      NULL, NapiStopWatch,       NULL, NULL, NULL, napi_default, NULL },
        { "native_init_signals",    NULL, NapiInitSignals,     NULL, NULL, NULL, napi_default, NULL },
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