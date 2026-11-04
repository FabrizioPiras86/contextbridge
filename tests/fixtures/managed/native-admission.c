// Offline experiment only: no caller-supplied executable or production linkage.
#ifdef __APPLE__
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stopping;
static void request_stop(int signal) { (void)signal; stopping = 1; }
static long long now_ms(void) {
    struct timespec time;
    if (clock_gettime(CLOCK_MONOTONIC, &time) != 0) _exit(90);
    return (long long)time.tv_sec * 1000 + time.tv_nsec / 1000000;
}
static void report(const char *event, unsigned signals) {
    // Fixed vocabulary only; never emit paths, PIDs, environment or errno text.
    printf("{\"event\":\"%s\",\"signals\":%u,\"spawnAuthorized\":false,"
           "\"productionEligible\":false}\n", event, signals);
    fflush(stdout);
}
static int mark(const char *name) {
    int fd = open(name, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd < 0) return -1;
    int result = write(fd, "fixture\n", 8) == 8 ? 0 : -1;
    if (close(fd) != 0) result = -1;
    return result;
}
static bool exists(const char *name) { return access(name, F_OK) == 0; }

static int workload(const char *mode) {
    // Hard-failure experiments begin only after this disposable lifetime is armed.
    alarm(6);
    bool hung = strcmp(mode, "hung") == 0;
    if (hung) signal(SIGTERM, SIG_IGN);
    if (mark("workload-entered") != 0) return 2;
    if (strcmp(mode, "normal") == 0) return mark("workload-exit") != 0;
    if (strcmp(mode, "escaped") == 0 || strcmp(mode, "regrouped") == 0) {
        pid_t descendant = fork();
        if (descendant < 0) return 2;
        if (descendant == 0) {
            alarm(6);
            int result = strcmp(mode, "escaped") == 0 ? (int)setsid() : setpgid(0, 0);
            if (result < 0 || mark("escaped-ready") != 0) _exit(2);
            while (!exists("emergency-stop")) poll(NULL, 0, 10);
            _exit(mark("escaped-exit") != 0);
        }
    }
    if (mark("workload-ready") != 0) return 2;
    while (!exists("emergency-stop")) poll(NULL, 0, 10);
    return mark("workload-exit") != 0;
}

typedef struct {
    pid_t pid;
    bool reaped;
    bool uncertain;
    unsigned signals;
} Owner;

static void observe(Owner *owner) {
    if (owner->reaped || owner->uncertain) return;
    if (owner->pid <= 0) { owner->uncertain = true; return; }
    int status;
    pid_t result = waitpid(owner->pid, &status, WNOHANG);
    if (result == owner->pid) owner->reaped = true;
    else if (result < 0 && errno != EINTR) owner->uncertain = true;
}
static void send_owned(Owner *owner, int signal) {
    observe(owner);
    if (owner->reaped || owner->uncertain) return;
    // This single-threaded supervisor alone reaps its direct child. Until waitpid
    // reaps it, that child's PID cannot be reused. No group/PID discovery occurs.
    owner->signals++;
    if (kill(owner->pid, signal) != 0) owner->uncertain = true;
}
static void await_exit(Owner *owner, int budget_ms) {
    long long deadline = now_ms() + budget_ms;
    do {
        observe(owner);
        if (owner->reaped || owner->uncertain) return;
        poll(NULL, 0, 5);
    } while (now_ms() < deadline);
}
static void cleanup(Owner *owner, bool released) {
    if (!owner->reaped && !owner->uncertain) {
        send_owned(owner, released ? SIGTERM : SIGKILL);
        await_exit(owner, 150);
        if (!owner->reaped && !owner->uncertain) send_owned(owner, SIGKILL);
        await_exit(owner, 500);
        if (!owner->reaped) owner->uncertain = true;
    }
    report(owner->uncertain ? "cleanup-unconfirmed" : "direct-child-reaped", owner->signals);
}

int main(int argc, char **argv) {
    if (argc == 3 && strcmp(argv[1], "--workload") == 0) return workload(argv[2]);
    if (argc != 3 || (strcmp(argv[2], "normal") && strcmp(argv[2], "hung") &&
                     strcmp(argv[2], "running") && strcmp(argv[2], "escaped") &&
                     strcmp(argv[2], "regrouped"))) return 2;
    // The test supplies a fresh private temporary directory; no project commands.
    if (chdir(argv[1]) != 0) return 2;
    signal(SIGPIPE, SIG_IGN);
    struct sigaction child_status = {0};
    child_status.sa_handler = SIG_DFL;
    sigemptyset(&child_status.sa_mask);
    // Do not inherit SIGCHLD ignoring/SA_NOCLDWAIT: the sole reaper anchors identity.
    if (sigaction(SIGCHLD, &child_status, NULL) != 0) return 2;
    struct sigaction action = {0};
    action.sa_handler = request_stop;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL)) return 2;
    posix_spawnattr_t attr;
    posix_spawn_file_actions_t files;
    if (posix_spawnattr_init(&attr) != 0) return 2;
    if (posix_spawn_file_actions_init(&files) != 0) { posix_spawnattr_destroy(&attr); return 2; }
    int error = posix_spawnattr_setflags(&attr, POSIX_SPAWN_START_SUSPENDED |
                                       POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT);
    if (!error) error = posix_spawnattr_setpgroup(&attr, 0);
    // Workload inherits no control, diagnostic or arbitrary caller descriptors.
    for (int fd = 0; fd < 3 && !error; fd++)
        error = posix_spawn_file_actions_addopen(&files, fd, "/dev/null", O_RDWR, 0);
    char *child_args[] = {argv[0], "--workload", argv[2], NULL};
    char *empty_env[] = {NULL};
    Owner owner = {0};
    if (!error) error = posix_spawn(&owner.pid, argv[0], &files, &attr, child_args, empty_env);
    posix_spawn_file_actions_destroy(&files);
    posix_spawnattr_destroy(&attr);
    if (error) { report("admission-failed", 0); return 2; }
    // Check an actual stopped-child status, not merely the spawn return value.
    long long deadline = now_ms() + 1000;
    bool suspended = false;
    while (now_ms() < deadline && !stopping) {
        int status;
        pid_t result = waitpid(owner.pid, &status, WNOHANG | WUNTRACED);
        if (result == owner.pid) {
            if (WIFSTOPPED(status)) suspended = true;
            else owner.reaped = true;
            break;
        }
        if (result < 0 && errno != EINTR) { owner.uncertain = true; break; }
        poll(NULL, 0, 5);
    }
    if (!suspended || exists("workload-entered")) { cleanup(&owner, false); return 2; }
    report("suspended-before-entry", 0);
    bool released = false;
    deadline = now_ms() + 5000;
    while (!stopping && now_ms() < deadline) {
        struct pollfd control = {STDIN_FILENO, POLLIN, 0};
        int result = poll(&control, 1, 20);
        if (result < 0) { if (errno == EINTR) continue; break; }
        if (!result) continue;
        char command;
        if (read(STDIN_FILENO, &command, 1) != 1) break;
        if (command == 'R') {
            if (!released && !owner.reaped && !owner.uncertain) {
                send_owned(&owner, SIGCONT);
                released = !owner.uncertain && !owner.reaped;
                report(released ? "released" : "admission-failed", owner.signals);
            } else report("admission-failed", owner.signals);
        } else if (command == 'O') {
            await_exit(&owner, 500);
            report(owner.reaped ? "observed-child-exit" : "exit-unconfirmed", owner.signals);
        } else if (command == 'S') cleanup(&owner, released);
        else if (command == 'U' && released) {
            // Explicit fault injection: revoke authority, never signal again.
            owner.uncertain = true;
            cleanup(&owner, released);
        } else if (command == 'X' && released && exists("workload-ready")) _exit(7);
        else { cleanup(&owner, released); return 2; }
    }
    cleanup(&owner, released);
    return owner.uncertain ? 3 : 0;
}
#else
// No emulation or fallback to ordinary spawn on unsupported platforms.
int main(void) { return 78; }
#endif
