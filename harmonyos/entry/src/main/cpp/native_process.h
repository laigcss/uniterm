/*
 * native_process.h - NDK 原生子进程管理头文件
 *
 * 声明 fork+execve 子进程管理、stdout/stderr 捕获、崩溃自动重启、
 * HTTP 健康检查、进程资源监控等相关接口。
 *
 * 适用于鸿蒙 NDK（musl libc），C99 标准。
 */

#ifndef NATIVE_PROCESS_H
#define NATIVE_PROCESS_H

#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================== */
/* 常量定义                                                                    */
/* ========================================================================== */

/* 最大自动重启次数（子进程崩溃后最多重启 3 次） */
#define MAX_RESTART_COUNT       3

/* 重启间隔（毫秒），崩溃后等待 1 秒再重启 */
#define RESTART_INTERVAL_MS     1000

/* 默认日志文件路径（鸿蒙应用沙箱可写目录） */
#define DEFAULT_LOG_PATH        "/data/storage/el2/base/files/ai-ops-terminal.log"

/* 健康检查请求路径 */
#define HEALTH_CHECK_PATH       "/health"

/* 默认监听端口 */
#define DEFAULT_PORT            9245

/* HTTP 健康检查响应缓冲区大小 */
#define HEALTH_RESPONSE_BUFFER  1024

/* 日志读取单次缓冲区大小 */
#define LOG_READ_BUFFER         4096

/* 路径最大长度 */
#define MAX_PATH_LEN            512

/* 监控线程轮询间隔（毫秒） */
#define WATCH_POLL_INTERVAL_MS  200

/* 优雅终止等待超时（毫秒），超时后发送 SIGKILL */
#define GRACEFUL_STOP_TIMEOUT_MS 3000

/* CPU 使用率采样间隔（毫秒） */
#define CPU_SAMPLE_INTERVAL_MS  100

/* ========================================================================== */
/* 数据结构                                                                    */
/* ========================================================================== */

/*
 * 进程资源信息结构体。
 * 用于 get_process_info 返回子进程的内存和 CPU 使用情况。
 */
typedef struct {
    pid_t pid;              /* 进程 ID */
    long memory_kb;         /* 物理内存使用量（KB），对应 /proc/[pid]/status 的 VmRSS */
    double cpu_percent;     /* CPU 使用率（百分比，0.0~100.0，单核） */
    int is_running;         /* 是否运行中（1 运行中，0 已退出） */
    int exit_code;          /* 退出码（若已退出，-1 表示异常退出） */
} ProcessInfo;

/* ========================================================================== */
/* 公开函数声明                                                                */
/* ========================================================================== */

/*
 * 启动 Go 二进制子进程。
 *
 * 通过 fork + execve 启动子进程，创建管道捕获 stdout/stderr 并写入日志文件，
 * 继承当前环境变量并覆盖 AI_OPS_HOST / AI_OPS_PORT。
 *
 * 参数:
 *   binaryPath - Go 二进制完整路径（已赋予执行权限）
 *   port       - Go 后端监听端口
 *
 * 返回:
 *   >0  子进程 PID（成功）
 *   -1  fork 失败
 *   -2  execve 失败（子进程内，不会实际返回到父进程）
 *   -3  管道创建失败
 */
int start_process(const char *binaryPath, int port);

/*
 * 终止子进程。
 * 先发送 SIGTERM 优雅终止，等待 GRACEFUL_STOP_TIMEOUT_MS 后若仍存活则发送 SIGKILL。
 *
 * 参数:
 *   pid - 子进程 PID
 */
void stop_process(int pid);

/*
 * 检查子进程是否存活。
 *
 * 返回: 1 存活, 0 已退出
 */
int is_running(int pid);

/*
 * 修改文件权限。
 *
 * 返回: 0 成功, 非 0 为 errno
 */
int do_chmod(const char *path, int mode);

/*
 * 将二进制数据写入文件并赋予执行权限。
 * 使用 open(path, O_CREAT|O_WRONLY|O_TRUNC, 0755) 创建文件，
 * 再用 fchmod(fd, 0755) 强制设置权限（覆盖 umask 影响），
 * 避免 chmod() 被 SELinux 阻止的问题。
 *
 * 参数:
 *   path   - 目标文件路径
 *   data   - 二进制数据指针
 *   length - 数据长度（字节）
 *
 * 返回: 0 成功, 非 0 为 errno
 */
int save_executable(const char *path, const void *data, size_t length);

/*
 * 检查文件是否存在且可执行。
 *
 * 返回: 1 可执行, 0 不可执行或不存在
 */
int is_executable(const char *path);

/*
 * HTTP 健康检查。
 * 发送完整的 HTTP GET 请求 "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n"，
 * 读取响应并检查状态码是否为 200。
 *
 * 参数:
 *   host      - 主机名（如 "localhost"）
 *   port      - 端口号
 *   timeoutMs - 超时时间（毫秒）
 *
 * 返回: 1 就绪（HTTP 200）, 0 未就绪
 */
int wait_for_health(const char *host, int port, int timeoutMs);

/*
 * 获取进程资源使用信息。
 * 通过 /proc/[pid]/status 读取 VmRSS（内存），通过 /proc/[pid]/stat 采样计算 CPU 使用率。
 *
 * 参数:
 *   pid  - 目标进程 PID
 *   info - 输出参数，填充 ProcessInfo 结构体
 *
 * 返回: 0 成功, -1 失败
 */
int get_process_info(int pid, ProcessInfo *info);

/*
 * 启动进程监控（崩溃自动重启）。
 * 在独立线程中监控子进程状态，若异常退出则自动重启（最多 MAX_RESTART_COUNT 次）。
 *
 * 参数:
 *   pid        - 要监控的子进程 PID
 *   binaryPath - Go 二进制路径（重启时使用）
 *   port       - 监听端口（重启时使用）
 *
 * 返回: 0 成功, -1 失败
 */
int watch_process(int pid, const char *binaryPath, int port);

/*
 * 停止进程监控。
 * 设置停止标志，监控线程将在下一次轮询时退出，不再自动重启。
 */
void stop_watch(void);

/*
 * 初始化信号处理。
 * 注册 SIGCHLD 处理函数（回收僵尸进程）并忽略 SIGPIPE（避免管道写入导致进程退出）。
 */
void init_signal_handlers(void);

#ifdef __cplusplus
}
#endif

#endif /* NATIVE_PROCESS_H */