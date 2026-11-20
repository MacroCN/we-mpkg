// 极简 JNI 桥：把 Java 传入的参数数组交给 libnode 的 node::Start。
// 不使用 nodejs-mobile 的 cordova-bridge（npm 包里缺 cordova-bridge.h），只做最小实现。
// stdout/stderr 同时写入 logcat 和一个日志文件，方便无 adb 环境下排查。
#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <pthread.h>
#include <android/log.h>

#include "node.h"

#define LOGTAG "wempkg-jni"

static int pipe_out[2];
static int pipe_err[2];
static FILE *log_fp = NULL;

static void emit(const char *buf) {
    __android_log_write(ANDROID_LOG_INFO, "wempkg-node", buf);
    if (log_fp != NULL) {
        fputs(buf, log_fp);
        fputc('\n', log_fp);
        fflush(log_fp);
    }
}

static void *drain(void *arg) {
    int fd = *(int *) arg;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf) - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        emit(buf);
    }
    return NULL;
}

static int redirect_std_to_logcat(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    if (pipe(pipe_out) != 0 || pipe(pipe_err) != 0) return -1;
    dup2(pipe_out[1], STDOUT_FILENO);
    dup2(pipe_err[1], STDERR_FILENO);

    pthread_t t1, t2;
    if (pthread_create(&t1, NULL, drain, &pipe_out[0]) != 0) return -1;
    if (pthread_create(&t2, NULL, drain, &pipe_err[0]) != 0) return -1;
    pthread_detach(t1);
    pthread_detach(t2);
    return 0;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wempkg_app_NodeRunner_startNode(JNIEnv *env, jclass clazz,
                                         jobjectArray arguments, jstring nodePath,
                                         jstring tmpDir, jstring logPath) {
    const char *path = env->GetStringUTFChars(nodePath, 0);
    setenv("NODE_PATH", path, 1);
    env->ReleaseStringUTFChars(nodePath, path);

    if (tmpDir != NULL) {
        const char *tmp = env->GetStringUTFChars(tmpDir, 0);
        setenv("TMPDIR", tmp, 1);
        setenv("HOME", tmp, 1);
        env->ReleaseStringUTFChars(tmpDir, tmp);
    }

    if (logPath != NULL) {
        const char *lp = env->GetStringUTFChars(logPath, 0);
        log_fp = fopen(lp, "a");
        env->ReleaseStringUTFChars(logPath, lp);
        if (log_fp == NULL) {
            __android_log_write(ANDROID_LOG_ERROR, LOGTAG, "cannot open log file");
        }
    }

    redirect_std_to_logcat();
    emit("[jni] entering node::Start");

    jsize argc = env->GetArrayLength(arguments);

    // node 的 libuv 要求 argv 在连续内存里
    int total = 0;
    for (jsize i = 0; i < argc; i++) {
        jstring a = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *s = env->GetStringUTFChars(a, 0);
        total += (int) strlen(s) + 1;
        env->ReleaseStringUTFChars(a, s);
        env->DeleteLocalRef(a);
    }

    char *buf = (char *) calloc((size_t) total, sizeof(char));
    char **argv = (char **) calloc((size_t) argc, sizeof(char *));
    if (buf == NULL || argv == NULL) {
        emit("[jni] calloc failed");
        return -1;
    }

    char *cur = buf;
    for (jsize i = 0; i < argc; i++) {
        jstring a = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *s = env->GetStringUTFChars(a, 0);
        strncpy(cur, s, strlen(s));
        argv[i] = cur;
        cur += strlen(cur) + 1;
        env->ReleaseStringUTFChars(a, s);
        env->DeleteLocalRef(a);
    }

    char line[512];
    snprintf(line, sizeof(line), "[jni] argc=%d argv=%s %s %s", (int) argc, argv[0],
             argc > 1 ? argv[1] : "", argc > 2 ? argv[2] : "");
    emit(line);

    int code = node::Start((int) argc, argv);

    snprintf(line, sizeof(line), "[jni] node exited with %d", code);
    emit(line);

    free(argv);
    free(buf);
    return code;
}
