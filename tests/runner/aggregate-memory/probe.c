/* Fixed Linux diagnostic for the isolated lab VM. No student input. */
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

struct child {
    pid_t pid;
    int channel;
};

static void fail(const char *step) {
    fprintf(stderr, "PROBE_ERROR %s\n", step);
    _exit(70);
}

static int reads_value(const char *path, const char *expected) {
    char buffer[64];
    FILE *file = fopen(path, "r");
    if (file == NULL) return 0;
    int matched = fgets(buffer, sizeof(buffer), file) != NULL &&
                  strcmp(buffer, expected) == 0;
    fclose(file);
    return matched;
}

/* All allocations are private, dirty and retained until this process exits. */
static void hold_pages(int mib) {
    size_t length = (size_t)mib * 1024 * 1024;
    long page_size = sysconf(_SC_PAGESIZE);
    if (page_size <= 0) fail("page_size");
    volatile unsigned char *data = mmap(NULL, length, PROT_READ | PROT_WRITE,
                                         MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (data == MAP_FAILED) fail("mmap");
    for (size_t offset = 0; offset < length; offset += (size_t)page_size)
        data[offset] = 1;
}

static int receive(int fd) {
    char byte;
    ssize_t count;
    do { count = read(fd, &byte, 1); } while (count < 0 && errno == EINTR);
    if (count < 0 && errno != ECONNRESET) fail("receive");
    return count == 1 ? byte : -1;
}

static void send_marker(int fd, char byte) {
    if (write(fd, &byte, 1) != 1) fail("send");
}

/* The mask control gives its child a higher OOM selection weight so that the
 * parent can report a nominal success after losing that child. */
static void prefer_child_for_oom(void) {
    FILE *file = fopen("/proc/self/oom_score_adj", "w");
    if (file == NULL || fputs("500\n", file) < 0 || fclose(file) != 0 ||
        !reads_value("/proc/self/oom_score_adj", "500\n"))
        fail("oom_weight");
}

static struct child start_child(int mib, int previous_channel, int masked) {
    int channel[2];
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, channel) < 0) fail("socketpair");
    pid_t parent = getpid();
    pid_t pid = fork();
    if (pid < 0) fail("fork");
    if (pid == 0) {
        close(channel[0]);
        if (previous_channel >= 0) close(previous_channel);
        if (prctl(PR_SET_PDEATHSIG, SIGKILL) < 0 || getppid() != parent)
            fail("parent_lost");
        alarm(5);
        if (masked) prefer_child_for_oom();
        send_marker(channel[1], 'R');
        if (receive(channel[1]) != 'A') fail("allocate_request");
        hold_pages(mib);
        send_marker(channel[1], 'D');
        if (receive(channel[1]) != 'F') fail("finish_request");
        _exit(0);
    }
    close(channel[1]);
    if (receive(channel[0]) != 'R') fail("child_ready");
    return (struct child){pid, channel[0]};
}

static int reap_child(struct child child) {
    int status;
    if (waitpid(child.pid, &status, 0) != child.pid) fail("waitpid");
    close(child.channel);
    if (WIFSIGNALED(status)) {
        printf("CHILD_SIGNAL %d %d\n", (int)child.pid, WTERMSIG(status));
        return WTERMSIG(status);
    }
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) fail("child_exit");
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 2) return 64;
    const char *mode = argv[1];
    int parent_only = strcmp(mode, "parent-only") == 0;
    int child_only = strcmp(mode, "child-only") == 0;
    int pair_low = strcmp(mode, "pair-low") == 0;
    int pair_high = strcmp(mode, "pair-high") == 0;
    int branches_low = strcmp(mode, "branches-low") == 0;
    int branches_high = strcmp(mode, "branches-high") == 0;
    int masked = strcmp(mode, "masked-child") == 0;
    if (!(parent_only || child_only || pair_low || pair_high ||
          branches_low || branches_high || masked)) return 64;
    if (!reads_value("/sys/fs/cgroup/memory.max", "134217728\n") ||
        !reads_value("/sys/fs/cgroup/memory.swap.max", "0\n") ||
        !reads_value("/sys/fs/cgroup/pids.max", "32\n") ||
        !reads_value("/sys/fs/cgroup/cpu.max", "100000 100000\n"))
        fail("unexpected_cgroup");

    setvbuf(stdout, NULL, _IONBF, 0);
    signal(SIGPIPE, SIG_IGN);
    alarm(5);
    int mib = pair_low || branches_low ? 40 : 72;
    int branches = branches_low || branches_high;
    struct child first = {0, -1}, second = {0, -1};
    if (branches) first = start_child(mib, -1, 0);
    if (!parent_only) second = start_child(mib, first.channel, masked);
    printf("READY %s %d %d %d\n", mode, (int)getpid(),
           (int)(branches ? first.pid : second.pid), (int)(branches ? second.pid : 0));
    usleep(600000);

    if (branches) {
        send_marker(first.channel, 'A');
        if (receive(first.channel) != 'D') fail("first_resident");
    } else if (!child_only) {
        hold_pages(mib);
    }
    if (!child_only) printf("FIRST_RESIDENT %d\n", mib);
    if (!child_only && !parent_only) usleep(180000);
    if (!parent_only) {
        printf("PRESSURE %d\n", mib);
        send_marker(second.channel, 'A');
        if (receive(second.channel) != 'D') {
            int killed = reap_child(second);
            if (masked && killed == SIGKILL) {
                puts("MASKED_SUCCESS");
                return 0;
            }
            return 72;
        }
    }
    /* The first allocation survives while the second writes its pages. Both
     * workers wait for the parent to release this barrier. */
    if (!parent_only && !child_only) puts("OVERLAP");
    usleep(250000);
    if (branches) {
        send_marker(first.channel, 'F');
        if (reap_child(first) != 0) return 72;
    }
    if (!parent_only) {
        send_marker(second.channel, 'F');
        if (reap_child(second) != 0) return 72;
    }
    puts("PASS");
    return 0;
}
