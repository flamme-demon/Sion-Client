/* Horloge murale du seul processus de test ; aucun changement système.
 * Cette bibliothèque n'est jamais exportée dans le paquet serveur. Les
 * horloges monotones et les temporisations restent celles du système. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <time.h>

int clock_gettime(clockid_t kind, struct timespec *value) {
    int (*original)(clockid_t, struct timespec *) = dlsym(RTLD_NEXT, "clock_gettime");
    if (!original) { errno = ENOSYS; return -1; }
    int result = original(kind, value);
    if (result == 0 && kind == CLOCK_REALTIME) {
        const char *offset = getenv("SION_TEST_CLOCK_SECONDS");
        if (offset) value->tv_sec += strtoll(offset, NULL, 10);
    }
    return result;
}
