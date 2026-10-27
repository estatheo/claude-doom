// doomgeneric backend for the Claude Code pane.
//
// Frames go out as a file of terminal cells, laid out exactly as a Raster's
// `cells` (u32 little-endian [codePoint, fg, bg] per cell, row-major), so the
// hooks module only has to read the file and blit it. Each cell is a upper
// half block: its foreground is the top pixel and its background the bottom
// one, which makes half-block pixels about square in a terminal cell.
//
// Keys come in as a file of "seq code" lines the hooks module rewrites; lines
// whose seq is past the last one seen are new presses. A terminal reports
// presses only, so a key counts as held until it stops repeating. Code -1
// quits.
//
// Environment:
//   DOOM_FRAME  where to write the frame (written to <path>.tmp, then renamed)
//   DOOM_KEYS   the key file to poll
//   DOOM_SIZE   "columns rows" of the Raster; re-read twice a second

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "doomgeneric.h"

#define HALF_BLOCK 0x2580
#define MAX_COLUMNS 512
#define MAX_ROWS 256
// A first press is held long enough to cover the keyboard's delay before it
// repeats; each repeat after that only has to reach the next one.
#define FIRST_HOLD_MS 400
#define REPEAT_HOLD_MS 150

static const char *frame_path, *keys_path, *size_path;
static char frame_tmp[1024];
static int columns = 120, rows = 45;
static uint32_t size_read_at;
static uint32_t cells[MAX_COLUMNS * MAX_ROWS * 3];

static long last_seq = -1;
static uint32_t keys_read_at;
static uint32_t held_until[256];

#define QUEUE 64
static struct { unsigned char key; int pressed; } queue[QUEUE];
static int q_head, q_tail;

static void push(unsigned char key, int pressed)
{
    int next = (q_tail + 1) % QUEUE;
    if (next == q_head) return;
    queue[q_tail].key = key;
    queue[q_tail].pressed = pressed;
    q_tail = next;
}

uint32_t DG_GetTicksMs()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
}

void DG_SleepMs(uint32_t ms)
{
    usleep(ms * 1000);
}

void DG_SetWindowTitle(const char *title)
{
    (void)title;
}

static void read_size(void)
{
    if (!size_path) return;
    FILE *f = fopen(size_path, "r");
    if (!f) return;
    int c, r;
    if (fscanf(f, "%d %d", &c, &r) == 2 && c > 0 && r > 0 && c <= MAX_COLUMNS && r <= MAX_ROWS) {
        columns = c;
        rows = r;
    }
    fclose(f);
}

void DG_Init()
{
    frame_path = getenv("DOOM_FRAME");
    keys_path = getenv("DOOM_KEYS");
    size_path = getenv("DOOM_SIZE");
    if (!frame_path) frame_path = "frame.bin";
    snprintf(frame_tmp, sizeof frame_tmp, "%s.tmp", frame_path);
    read_size();
}

// The average colour of the screen pixels under one half-block pixel.
static uint32_t sample(int x0, int x1, int y0, int y1)
{
    if (x1 <= x0) x1 = x0 + 1;
    if (y1 <= y0) y1 = y0 + 1;
    uint32_t r = 0, g = 0, b = 0, n = 0;
    for (int y = y0; y < y1; y++) {
        const pixel_t *row = DG_ScreenBuffer + y * DOOMGENERIC_RESX;
        for (int x = x0; x < x1; x++) {
            uint32_t p = row[x];
            r += (p >> 16) & 0xff;
            g += (p >> 8) & 0xff;
            b += p & 0xff;
            n++;
        }
    }
    return ((r / n) << 16) | ((g / n) << 8) | (b / n);
}

void DG_DrawFrame()
{
    uint32_t now = DG_GetTicksMs();
    if (now - size_read_at > 500) {
        read_size();
        size_read_at = now;
    }

    int pixel_rows = rows * 2;
    uint32_t *out = cells;
    for (int cy = 0; cy < rows; cy++) {
        int top0 = (2 * cy) * DOOMGENERIC_RESY / pixel_rows;
        int top1 = (2 * cy + 1) * DOOMGENERIC_RESY / pixel_rows;
        int bot1 = (2 * cy + 2) * DOOMGENERIC_RESY / pixel_rows;
        for (int cx = 0; cx < columns; cx++) {
            int x0 = cx * DOOMGENERIC_RESX / columns;
            int x1 = (cx + 1) * DOOMGENERIC_RESX / columns;
            *out++ = HALF_BLOCK;
            *out++ = sample(x0, x1, top0, top1);
            *out++ = sample(x0, x1, top1, bot1);
        }
    }

    FILE *f = fopen(frame_tmp, "wb");
    if (!f) return;
    fwrite(cells, sizeof(uint32_t), (size_t)columns * rows * 3, f);
    fclose(f);
    rename(frame_tmp, frame_path);
}

static void poll_keys(void)
{
    uint32_t now = DG_GetTicksMs();

    for (int k = 0; k < 256; k++) {
        if (held_until[k] && (int32_t)(now - held_until[k]) >= 0) {
            held_until[k] = 0;
            push((unsigned char)k, 0);
        }
    }

    if (!keys_path || now - keys_read_at < 10) return;
    keys_read_at = now;
    FILE *f = fopen(keys_path, "r");
    if (!f) return;
    char line[64];
    while (fgets(line, sizeof line, f)) {
        // A line the writer had not finished has no newline yet.
        if (!strchr(line, '\n')) break;
        long seq;
        int code;
        if (sscanf(line, "%ld %d", &seq, &code) != 2 || seq <= last_seq) continue;
        last_seq = seq;
        // The pane closed: the hooks module cannot end a child that writes nothing.
        if (code == -1) exit(0);
        if (code <= 0 || code > 255) continue;
        if (held_until[code]) {
            held_until[code] = now + REPEAT_HOLD_MS;
        } else {
            held_until[code] = now + FIRST_HOLD_MS;
            push((unsigned char)code, 1);
        }
    }
    fclose(f);
}

int DG_GetKey(int *pressed, unsigned char *key)
{
    if (q_head == q_tail) poll_keys();
    if (q_head == q_tail) return 0;
    *key = queue[q_head].key;
    *pressed = queue[q_head].pressed;
    q_head = (q_head + 1) % QUEUE;
    return 1;
}

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);
    for (;;) doomgeneric_Tick();
    return 0;
}
