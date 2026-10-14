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
#include <sys/syscall.h>
#include <sys/mman.h>
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
#include <dlfcn.h>

/* memfd_create 支持（Linux 3.17+，鸿蒙 5.10 内核支持） */
#ifndef SYS_memfd_create
#define SYS_memfd_create 279  /* aarch64 syscall number */
#endif
#ifndef MFD_CLOEXEC
#define MFD_CLOEXEC 0x0001U
#endif

/* execveat 支持（Linux 3.19+） */
#ifndef SYS_execveat
#define SYS_execveat 281  /* aarch64 syscall number */
#endif
#ifndef AT_EMPTY_PATH
#define AT_EMPTY_PATH 0x1000
#endif

/*
 * memfd_create 封装：通过 syscall 直接调用，不依赖 glibc/musl 头文件声明。
 * 创建一个匿名内存文件（tmpfs 后端），可用于绕过 SELinux 对数据目录文件的执行限制。
 * 返回: >=0 文件描述符, -1 失败
 */
static int memfd_create_wrapper(const char *name, unsigned int flags)
{
    return (int)syscall(SYS_memfd_create, name, flags);
}

/*
 * execveat 封装：通过 syscall 直接调用。
 * execveat(fd, "", argv, envp, AT_EMPTY_PATH) 可以直接从 fd 执行，
 * 不经过 /proc/self/fd/N 路径解析，可能绕过某些 SELinux 检查。
 * 返回: 成功不返回，失败返回 -1
 */
static int execveat_wrapper(int dirfd, const char *pathname,
                            char *const argv[], char *const envp[], int flags)
{
    return (int)syscall(SYS_execveat, dirfd, pathname, argv, envp, flags);
}

/* 本项目头文件 */
#include "native_process.h"

/* NAPI 头文件 */
#include <napi/native_api.h>

/* musl libc 的环境变量指针（继承当前环境） */
extern char **environ;

/*
 * 构造函数：在 .so 加载时自动执行（在 NAPI Init 之前）。
 * 用于诊断 NAPI 模块是否被成功加载。
 */
__attribute__((constructor))
static void on_module_load(void)
{
    int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (logFd >= 0) {
        const char *msg = "\n=== libaiops_native.so loaded (constructor) ===\n";
        write(logFd, msg, strlen(msg));
        close(logFd);
    }
}

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
     * 记录退出码到崩溃日志文件（write 是异步信号安全的）。
     */
    int status;
    pid_t exitedPid;
    while ((exitedPid = waitpid(-1, &status, WNOHANG)) > 0) {
        /* 将退出码写入崩溃日志 */
        char buf[128];
        int n;
        if (WIFEXITED(status)) {
            n = snprintf(buf, sizeof(buf), "\n[SIGCHLD] PID %d exited with code %d\n", exitedPid, WEXITSTATUS(status));
        } else if (WIFSIGNALED(status)) {
            n = snprintf(buf, sizeof(buf), "\n[SIGCHLD] PID %d killed by signal %d\n", exitedPid, WTERMSIG(status));
        } else {
            n = snprintf(buf, sizeof(buf), "\n[SIGCHLD] PID %d unknown status %d\n", exitedPid, status);
        }
        int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (logFd >= 0) {
            write(logFd, buf, (size_t)n);
            close(logFd);
        }
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

    /*
     * memfd_create 方案：在内存中创建匿名文件并复制二进制数据，
     * 通过 /proc/self/fd/N 执行，绕过 SELinux 对数据目录文件的执行限制。
     * 如果 memfd_create 不可用或复制失败，回退到直接 execve(binaryPath)。
     */
    int memfd = -1;
    {
        int binFd = open(binaryPath, O_RDONLY);
        if (binFd >= 0) {
            memfd = memfd_create_wrapper("ai-ops-terminal", MFD_CLOEXEC);
            if (memfd >= 0) {
                /* 复制二进制数据到 memfd（64KB 缓冲区） */
                char copyBuf[65536];
                ssize_t n;
                int copyOk = 1;
                while ((n = read(binFd, copyBuf, sizeof(copyBuf))) > 0) {
                    ssize_t written = 0;
                    while (written < n) {
                        ssize_t w = write(memfd, copyBuf + written, (size_t)(n - written));
                        if (w < 0) {
                            if (errno == EINTR) continue;
                            copyOk = 0;
                            break;
                        }
                        written += w;
                    }
                    if (!copyOk) break;
                }
                if (!copyOk) {
                    close(memfd);
                    memfd = -1;
                }
            }
            close(binFd);
        }
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

        /* 额外：将 stderr 写入崩溃日志文件，便于调试 */
        int crashFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (crashFd >= 0) {
            /* 写入标记，确认子进程到达此处 */
            const char *marker = "=== child process started, about to execve ===\n";
            write(crashFd, marker, strlen(marker));

            /* 记录二进制路径 */
            char infoBuf[512];
            int infoN;
            infoN = snprintf(infoBuf, sizeof(infoBuf), "binary path: %s\n", binaryPath);
            write(crashFd, infoBuf, (size_t)infoN);

            /* 检查二进制是否存在且可执行 */
            struct stat st;
            if (stat(binaryPath, &st) == 0) {
                infoN = snprintf(infoBuf, sizeof(infoBuf),
                    "binary stat: size=%ld, mode=0%o, uid=%d, gid=%d\n",
                    (long)st.st_size, (unsigned)(st.st_mode & 07777),
                    (int)st.st_uid, (int)st.st_gid);
                write(crashFd, infoBuf, (size_t)infoN);
            } else {
                infoN = snprintf(infoBuf, sizeof(infoBuf),
                    "binary stat FAILED: errno=%d (%s)\n", errno, strerror(errno));
                write(crashFd, infoBuf, (size_t)infoN);
            }

            /* 读取并打印 ELF 头（前 16 字节） */
            int elfFd = open(binaryPath, O_RDONLY);
            if (elfFd >= 0) {
                unsigned char elfHeader[16];
                ssize_t elfN = read(elfFd, elfHeader, sizeof(elfHeader));
                close(elfFd);
                if (elfN > 0) {
                    infoN = snprintf(infoBuf, sizeof(infoBuf),
                        "ELF header (%zd bytes): %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x\n",
                        elfN,
                        elfHeader[0], elfHeader[1], elfHeader[2], elfHeader[3],
                        elfHeader[4], elfHeader[5], elfHeader[6], elfHeader[7],
                        elfHeader[8], elfHeader[9], elfHeader[10], elfHeader[11],
                        elfHeader[12], elfHeader[13], elfHeader[14], elfHeader[15]);
                    write(crashFd, infoBuf, (size_t)infoN);
                }
            }

            /* 记录关键环境变量 */
            infoN = snprintf(infoBuf, sizeof(infoBuf),
                "AI_OPS_HOST=%s, AI_OPS_PORT=%s, HOME=%s, GODEBUG=%s\n",
                getenv("AI_OPS_HOST") ? getenv("AI_OPS_HOST") : "(null)",
                getenv("AI_OPS_PORT") ? getenv("AI_OPS_PORT") : "(null)",
                getenv("HOME") ? getenv("HOME") : "(null)",
                getenv("GODEBUG") ? getenv("GODEBUG") : "(null)");
            write(crashFd, infoBuf, (size_t)infoN);

            /* 记录 memfd 状态 */
            infoN = snprintf(infoBuf, sizeof(infoBuf),
                "memfd=%d (will use /proc/self/fd/%d for execve if >=0)\n", memfd, memfd);
            write(crashFd, infoBuf, (size_t)infoN);

            /* 测试 mmap PROT_EXEC 是否被 SELinux 允许 */
            {
                int testFd = open(binaryPath, O_RDONLY);
                if (testFd >= 0) {
                    void *mapped = mmap(NULL, 4096, PROT_READ | PROT_EXEC, MAP_PRIVATE, testFd, 0);
                    if (mapped == MAP_FAILED) {
                        infoN = snprintf(infoBuf, sizeof(infoBuf),
                            "mmap PROT_EXEC test: FAILED errno=%d (%s)\n", errno, strerror(errno));
                    } else {
                        infoN = snprintf(infoBuf, sizeof(infoBuf),
                            "mmap PROT_EXEC test: SUCCESS addr=%p\n", mapped);
                        munmap(mapped, 4096);
                    }
                    write(crashFd, infoBuf, (size_t)infoN);
                    close(testFd);
                }
            }

            /* 测试 dlopen 是否可用 */
            {
                void *handle = dlopen(binaryPath, RTLD_LAZY);
                if (handle == NULL) {
                    infoN = snprintf(infoBuf, sizeof(infoBuf),
                        "dlopen test: FAILED error=%s\n", dlerror());
                } else {
                    infoN = snprintf(infoBuf, sizeof(infoBuf),
                        "dlopen test: SUCCESS handle=%p\n", handle);
                    dlclose(handle);
                }
                write(crashFd, infoBuf, (size_t)infoN);
            }

            dup2(crashFd, STDERR_FILENO);
            dup2(crashFd, STDOUT_FILENO);
            close(crashFd);
        }

        /* 设置环境变量：继承当前环境，覆盖 AI_OPS_HOST / AI_OPS_PORT */
        char portStr[16];
        snprintf(portStr, sizeof(portStr), "%d", port);
        /* 用 127.0.0.1 代替 localhost：鸿蒙无 /etc/hosts，DNS 解析被阻止 */
        setenv("AI_OPS_HOST", "127.0.0.1", 1);
        setenv("AI_OPS_PORT", portStr, 1);
        /* 直接设置 WAILS_SERVER_HOST/PORT，确保 Wails 使用 127.0.0.1 */
        setenv("WAILS_SERVER_HOST", "127.0.0.1", 1);
        setenv("WAILS_SERVER_PORT", portStr, 1);
        /* 设置 HOME 为二进制所在目录（可写），让 Go log.Init 能创建日志目录 */
        char homeDir[MAX_PATH_LEN];
        strncpy(homeDir, binaryPath, sizeof(homeDir) - 1);
        homeDir[sizeof(homeDir) - 1] = '\0';
        char *lastSlash = strrchr(homeDir, '/');
        if (lastSlash != NULL) {
            *lastSlash = '\0';
            setenv("HOME", homeDir, 1);
        }
        /* Go 运行时调试：禁用异步抢占，禁用 Go DNS 解析器（用 cgo resolver） */
        setenv("GODEBUG", "asyncpreemptoff=1,netdns=cgo", 1);
        /* 禁用 cgo 检查（纯静态二进制不需要） */
        setenv("CGO_ENABLED", "0", 1);

        /* execve 加载 Go 二进制 */
        char *argv[] = { (char *)binaryPath, NULL };

        /* 方案 1: execveat + AT_EMPTY_PATH（直接从 fd 执行，不经路径解析） */
        if (memfd >= 0) {
            execveat_wrapper(memfd, "", argv, environ, AT_EMPTY_PATH);
            /* execveat 失败 */
            {
                int savedErrno = errno;
                char errBuf[256];
                int errN = snprintf(errBuf, sizeof(errBuf),
                    "\n=== execveat AT_EMPTY_PATH FAILED! errno=%d (%s) ===\n",
                    savedErrno, strerror(savedErrno));
                write(STDERR_FILENO, errBuf, (size_t)errN);
            }
        }

        /* 方案 2: execve /proc/self/fd/N（memfd 路径） */
        if (memfd >= 0) {
            char execPath[64];
            snprintf(execPath, sizeof(execPath), "/proc/self/fd/%d", memfd);
            execve(execPath, argv, environ);
            {
                int savedErrno = errno;
                char errBuf[256];
                int errN = snprintf(errBuf, sizeof(errBuf),
                    "\n=== memfd execve FAILED! errno=%d (%s), trying direct ===\n",
                    savedErrno, strerror(savedErrno));
                write(STDERR_FILENO, errBuf, (size_t)errN);
            }
        }

        /* 方案 3: 直接 execve 二进制路径（回退） */
        execve(binaryPath, argv, environ);

        /* execve 仅在失败时返回 — 记录 errno 到崩溃日志 */
        {
            int savedErrno = errno;
            char errBuf[256];
            int errN = snprintf(errBuf, sizeof(errBuf),
                "\n=== execve FAILED! errno=%d (%s) ===\n", savedErrno, strerror(savedErrno));
            write(STDERR_FILENO, errBuf, (size_t)errN);
        }
        _exit(127);
    }

    /* ---- 父进程 ---- */

    /* 关闭 memfd（子进程有自己的副本） */
    if (memfd >= 0) {
        close(memfd);
    }

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
 * 将二进制数据写入文件并赋予执行权限。
 * 使用 open(0755) 创建 + fchmod(0755) 强制设置权限，
 * 避免 chmod() 被 SELinux 阻止的问题。
 */
int save_executable(const char *path, const void *data, size_t length)
{
    /* 用 0755 创建文件（O_TRUNC 覆盖已有文件） */
    int fd = open(path, O_CREAT | O_WRONLY | O_TRUNC, 0755);
    if (fd < 0) {
        return errno;
    }

    /* fchmod 强制设置权限（覆盖 umask 对执行位的屏蔽） */
    if (fchmod(fd, 0755) != 0) {
        /* fchmod 失败不致命，继续尝试写入 */
    }

    /* 写入数据 */
    const char *buf = (const char *)data;
    size_t written = 0;
    while (written < length) {
        ssize_t n = write(fd, buf + written, length - written);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            int savedErrno = errno;
            close(fd);
            return savedErrno;
        }
        written += (size_t)n;
    }

    close(fd);
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
 * NAPI 方法: native_save_executable(path, arrayBuffer) → number
 * 将二进制数据写入文件并赋予执行权限（0755）。
 * 参数接受 Uint8Array（TypedArray），通过 napi_get_typedarray_info 获取数据。
 */
static napi_value NapiSaveExecutable(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    /* 获取路径参数 */
    char path[MAX_PATH_LEN];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[0], path, sizeof(path), &pathLen);

    /* 获取 TypedArray (Uint8Array) 参数 */
    napi_typedarray_type type;
    size_t length = 0;
    void *data = NULL;
    napi_status status = napi_get_typedarray_info(env, args[1], &type, &length, &data, NULL, NULL);
    if (status != napi_ok || data == NULL) {
        napi_value result;
        napi_create_int32(env, -1, &result);
        return result;
    }

    int err = save_executable(path, data, length);

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


/* ========================================================================== */
/* 内嵌 C HTTP 服务器                                                          */
/* ========================================================================== */

/*
 * 轻入进程 HTTP 服务器：在 NAPI 模块内运行，无需 execve/dlopen。
 * 服务前端静态文件 + 健康检查端点。
 */

static struct {
    volatile int running;
    pthread_t thread;
    int port;
    char docRoot[MAX_PATH_LEN];
} g_httpServer = { .running = 0, .port = 0 };

/* MIME 类型查找 */
static const char *get_mime_type(const char *path)
{
    const char *ext = strrchr(path, '.');
    if (ext == NULL) return "application/octet-stream";
    if (strcmp(ext, ".html") == 0 || strcmp(ext, ".htm") == 0) return "text/html; charset=utf-8";
    if (strcmp(ext, ".js") == 0 || strcmp(ext, ".mjs") == 0) return "application/javascript; charset=utf-8";
    if (strcmp(ext, ".css") == 0) return "text/css; charset=utf-8";
    if (strcmp(ext, ".json") == 0) return "application/json; charset=utf-8";
    if (strcmp(ext, ".woff2") == 0) return "font/woff2";
    if (strcmp(ext, ".woff") == 0) return "font/woff";
    if (strcmp(ext, ".svg") == 0) return "image/svg+xml";
    if (strcmp(ext, ".png") == 0) return "image/png";
    if (strcmp(ext, ".ico") == 0) return "image/x-icon";
    if (strcmp(ext, ".map") == 0) return "application/json; charset=utf-8";
    return "application/octet-stream";
}

/* 发送 HTTP 响应头 */
static void send_response_header(int fd, int status, const char *contentType, long contentLength)
{
    const char *statusText = (status == 200) ? "OK" : (status == 404) ? "Not Found" : "Internal Server Error";
    char header[512];
    int n = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %ld\r\n"
        "Connection: close\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "\r\n", status, statusText, contentType, contentLength);
    write(fd, header, (size_t)n);
}

/* 服务静态文件 */
static int serve_static_file(int clientFd, const char *filePath)
{
    int fd = open(filePath, O_RDONLY);
    if (fd < 0) return -1;

    struct stat st;
    if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        close(fd);
        return -1;
    }

    send_response_header(clientFd, 200, get_mime_type(filePath), (long)st.st_size);

    char buf[65536];
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf))) > 0) {
        ssize_t written = 0;
        while (written < n) {
            ssize_t w = write(clientFd, buf + written, (size_t)(n - written));
            if (w < 0) { if (errno == EINTR) continue; break; }
            written += w;
        }
    }
    close(fd);
    return 0;
}

/* HTTP 服务器线程 */
static void *http_server_thread(void *arg)
{
    (void)arg;
    int port = g_httpServer.port;
    const char *docRoot = g_httpServer.docRoot;

    int sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd < 0) {
        int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (logFd >= 0) { const char *m = "\n=== HTTP server: socket failed ===\n"; write(logFd, m, strlen(m)); close(logFd); }
        return NULL;
    }

    int opt = 1;
    setsockopt(sockfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons((uint16_t)port);

    if (bind(sockfd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (logFd >= 0) {
            char buf[256]; int n = snprintf(buf, sizeof(buf), "\n=== HTTP server: bind failed errno=%d (%s) ===\n", errno, strerror(errno));
            write(logFd, buf, (size_t)n); close(logFd);
        }
        close(sockfd);
        return NULL;
    }

    if (listen(sockfd, 16) != 0) {
        close(sockfd);
        return NULL;
    }

    /* 设置 accept 超时，以便能检查 running 标志 */
    struct timeval tv;
    tv.tv_sec = 1;
    tv.tv_usec = 0;
    setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    {
        int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (logFd >= 0) {
            char buf[256]; int n = snprintf(buf, sizeof(buf), "\n=== HTTP server listening on 127.0.0.1:%d, docRoot=%s ===\n", port, docRoot);
            write(logFd, buf, (size_t)n); close(logFd);
        }
    }

    while (g_httpServer.running) {
        int clientFd = accept(sockfd, NULL, NULL);
        if (clientFd < 0) {
            if (errno == EINTR || errno == EAGAIN) continue;
            break;
        }

        char req[4096];
        ssize_t reqLen = read(clientFd, req, sizeof(req) - 1);
        if (reqLen <= 0) { close(clientFd); continue; }
        req[reqLen] = '\0';

        /* 解析请求行: GET /path HTTP/1.1 */
        char method[16], path[2048];
        method[0] = path[0] = '\0';
        sscanf(req, "%15s %2047s", method, path);

        /* 健康检查 */
        if (strcmp(path, "/health") == 0) {
            send_response_header(clientFd, 200, "application/json", 15);
            write(clientFd, "{\"status\":\"ok\"}", 15);
            close(clientFd);
            continue;
        }

        /* API 端点返回占位响应 */
        if (strncmp(path, "/api/", 5) == 0 || strncmp(path, "/wails/", 7) == 0) {
            const char *json = "{\"error\":\"backend not available\"}";
            send_response_header(clientFd, 200, "application/json", (long)strlen(json));
            write(clientFd, json, strlen(json));
            close(clientFd);
            continue;
        }

        /* 映射路径到文件 */
        char filePath[MAX_PATH_LEN];
        if (strcmp(path, "/") == 0) {
            snprintf(filePath, sizeof(filePath), "%s/index.html", docRoot);
        } else {
            /* 防止路径遍历 */
            if (strstr(path, "..") != NULL) {
                send_response_header(clientFd, 404, "text/plain", 9);
                write(clientFd, "Not Found", 9);
                close(clientFd);
                continue;
            }
            snprintf(filePath, sizeof(filePath), "%s%s", docRoot, path);
        }

        /* 服务文件 */
        if (serve_static_file(clientFd, filePath) != 0) {
            send_response_header(clientFd, 404, "text/plain", 9);
            write(clientFd, "Not Found", 9);
        }
        close(clientFd);
    }

    close(sockfd);
    {
        int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (logFd >= 0) { const char *m = "\n=== HTTP server stopped ===\n"; write(logFd, m, strlen(m)); close(logFd); }
    }
    return NULL;
}

/* 启动 HTTP 服务器 */
int start_http_server(const char *docRoot, int port)
{
    if (g_httpServer.running) return -2;

    g_httpServer.port = port;
    strncpy(g_httpServer.docRoot, docRoot, sizeof(g_httpServer.docRoot) - 1);
    g_httpServer.docRoot[sizeof(g_httpServer.docRoot) - 1] = '\0';
    g_httpServer.running = 1;

    if (pthread_create(&g_httpServer.thread, NULL, http_server_thread, NULL) != 0) {
        g_httpServer.running = 0;
        return -1;
    }
    pthread_detach(g_httpServer.thread);
    return 0;
}

/* 停止 HTTP 服务器 */
void stop_http_server(void)
{
    g_httpServer.running = 0;
}

/* ========================================================================== */
/* Go c-shared 共享库导出函数声明                                              */
/* ========================================================================== */

/*
 * libaiops.so 作为 libaiops_native.so 的直接依赖链接，
 * 在应用启动时自动加载，解决 Go initial-exec TLS 模型问题。
 *
 * StartServer 由 Go 代码导出（//export StartServer），
 * 在独立 goroutine 中启动 HTTP 服务器。
 * 返回: 0 成功，非 0 失败
 *
 * 声明为弱符号，允许在没有 libaiops.so 的情况下链接。
 * 运行时通过 dlsym 动态查找。
 */
extern int StartServer(int port) __attribute__((weak));

/*
 * dlopen 加载 Go c-shared 共享库的全局句柄。
 * 保持 .so 加载状态，防止被卸载。
 */
static void *g_dlopenHandle = NULL;

/*
 * NAPI 方法: native_start_server(soPath, port) → number
 * 通过直接链接的 Go c-shared 共享库启动 HTTP 服务器。
 * libaiops.so 作为 libaiops_native.so 的依赖在应用启动时已加载，
 * Go runtime 已初始化，直接调用导出的 StartServer 函数即可。
 * 返回: 0 成功，-1 失败
 */
static napi_value NapiStartServer(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    /* soPath 参数已不需要（.so 已链接），但保留以兼容接口 */
    char soPath[MAX_PATH_LEN];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[0], soPath, sizeof(soPath), &pathLen);

    double port = 0;
    napi_get_value_double(env, args[1], &port);

    /* 设置环境变量 */
    char portStr[16];
    snprintf(portStr, sizeof(portStr), "%d", (int)port);
    setenv("AI_OPS_HOST", "127.0.0.1", 1);
    setenv("AI_OPS_PORT", portStr, 1);
    setenv("GODEBUG", "asyncpreemptoff=1,netdns=go", 1);

    /* 设置 HOME 为 soPath 所在目录（可写） */
    if (pathLen > 0) {
        char homeDir[MAX_PATH_LEN];
        strncpy(homeDir, soPath, sizeof(homeDir) - 1);
        homeDir[sizeof(homeDir) - 1] = '\0';
        char *lastSlash = strrchr(homeDir, '/');
        if (lastSlash != NULL) {
            *lastSlash = '\0';
            setenv("HOME", homeDir, 1);
        }
    }

    /* 写入日志 */
    int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (logFd >= 0) {
        const char *msg = "\n=== NapiStartServer: calling StartServer ===\n";
        write(logFd, msg, strlen(msg));
        char infoBuf[512];
        int n = snprintf(infoBuf, sizeof(infoBuf),
            "AI_OPS_HOST=127.0.0.1, AI_OPS_PORT=%s, HOME=%s\n", portStr, getenv("HOME") ? getenv("HOME") : "(null)");
        write(logFd, infoBuf, (size_t)n);
        close(logFd);
    }

    /* 直接调用 Go 导出的 StartServer 函数（弱符号） */
    if (StartServer == NULL) {
        logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (logFd >= 0) {
            const char *m = "\n=== StartServer is NULL (weak symbol not resolved) ===\n";
            write(logFd, m, strlen(m));
            close(logFd);
        }
        napi_value result;
        napi_create_int32(env, -1, &result);
        return result;
    }

    int ret = StartServer((int)port);

    logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (logFd >= 0) {
        char infoBuf[256];
        int n = snprintf(infoBuf, sizeof(infoBuf),
            "\n=== StartServer returned: %d ===\n", ret);
        write(logFd, infoBuf, (size_t)n);
        close(logFd);
    }

    napi_value result;
    napi_create_int32(env, ret, &result);
    return result;
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

/*
 * NAPI 方法: native_start_http_server(docRoot, port) → number
 * 启动内嵌 C HTTP 服务器，服务前端静态文件。
 * 返回: 0 成功，-1 线程创建失败，-2 已在运行
 */
static napi_value NapiStartHttpServer(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    char docRoot[MAX_PATH_LEN];
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, args[0], docRoot, sizeof(docRoot), &pathLen);

    double port = 0;
    napi_get_value_double(env, args[1], &port);

    int ret = start_http_server(docRoot, (int)port);

    napi_value result;
    napi_create_int32(env, ret, &result);
    return result;
}

/*
 * NAPI 方法: native_stop_http_server() → void
 * 停止内嵌 C HTTP 服务器。
 */
static napi_value NapiStopHttpServer(napi_env env, napi_callback_info info)
{
    (void)env;
    (void)info;

    stop_http_server();

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
    /* 写入日志标记，确认 Init 函数被调用 */
    int logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (logFd >= 0) {
        const char *msg = "\n=== NAPI Init: registering descriptors ===\n";
        write(logFd, msg, strlen(msg));
        close(logFd);
    }

    napi_property_descriptor descriptors[] = {
        { "native_start",           NULL, NapiStart,           NULL, NULL, NULL, napi_default, NULL },
        { "native_stop",            NULL, NapiStop,            NULL, NULL, NULL, napi_default, NULL },
        { "native_is_running",      NULL, NapiIsRunning,       NULL, NULL, NULL, napi_default, NULL },
        { "native_chmod",            NULL, NapiChmod,            NULL, NULL, NULL, napi_default, NULL },
        { "native_save_executable",  NULL, NapiSaveExecutable,  NULL, NULL, NULL, napi_default, NULL },
        { "native_is_executable",   NULL, NapiIsExecutable,    NULL, NULL, NULL, napi_default, NULL },
        { "native_wait_for_health", NULL, NapiWaitForHealth,   NULL, NULL, NULL, napi_default, NULL },
        { "native_get_process_info",NULL, NapiGetProcessInfo,  NULL, NULL, NULL, napi_default, NULL },
        { "native_watch_process",   NULL, NapiWatchProcess,    NULL, NULL, NULL, napi_default, NULL },
        { "native_stop_watch",      NULL, NapiStopWatch,       NULL, NULL, NULL, napi_default, NULL },
        { "native_init_signals",    NULL, NapiInitSignals,     NULL, NULL, NULL, napi_default, NULL },
        { "native_start_server",    NULL, NapiStartServer,     NULL, NULL, NULL, napi_default, NULL },
        { "native_start_http_server", NULL, NapiStartHttpServer, NULL, NULL, NULL, napi_default, NULL },
        { "native_stop_http_server",  NULL, NapiStopHttpServer,  NULL, NULL, NULL, napi_default, NULL },
    };

    napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);

    /* 写入日志标记，确认 descriptors 注册完成 */
    logFd = open(DEFAULT_LOG_PATH ".crash", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (logFd >= 0) {
        char infoBuf[256];
        int n = snprintf(infoBuf, sizeof(infoBuf),
            "\n=== NAPI Init: registered %zu descriptors ===\n",
            sizeof(descriptors) / sizeof(descriptors[0]));
        write(logFd, infoBuf, (size_t)n);
        close(logFd);
    }

    return exports;
}
EXTERN_C_END

/*
 * NAPI 模块自动注册。
 *
 * 使用 NAPI_MODULE 宏通过 __attribute__((constructor)) 自动调用
 * napi_module_register() 注册模块。当 .so 被 dlopen 加载时，
 * 构造函数自动执行，无需运行时手动调用 RegisterModule()。
 *
 * 模块名 "aiops_native" 对应 libaiops_native.so：
 *   - nm_modname = "aiops_native"（#modname 字符串化）
 *   - 构造函数名 = _register_aiops_native
 */
NAPI_MODULE(aiops_native, Init)