# Cereal — chiaki-ng Patches

These patches improve chiaki-ng for embedded launcher use. They're designed
as reference implementations — each one documents the exact code changes
needed, the files to modify, and the rationale.

The build script (`scripts/build-chiaki.sh`) automatically attempts to apply
any patches with standard unified diff format. Reference-only patches (which
describe the approach without exact line-level diffs) are flagged for manual
implementation.

## Patch Summary

| #   | Name                      | Impact    | Complexity | Status    |
|-----|---------------------------|-----------|------------|-----------|
| 001 | Auto-reconnect            | 🔴 High   | Medium     | Reference |
| 002 | JSON status output        | 🔴 High   | Low        | Reference |
| 003 | Adaptive bitrate          | 🟡 Medium | High       | Reference |
| 004 | Improved FEC recovery     | 🟡 Medium | Medium     | Reference |
| 005 | Launcher integration mode | 🔴 High   | Medium     | Reference |
| 006 | Windows HW decode/latency | 🟡 Medium | Low-Medium | Reference |

---

## 001 — Auto-Reconnect on Disconnect

**Problem:** The single most reported issue across the tracker. Sessions drop
due to transient network blips (WiFi interference, router hiccup, PS5 sleep
timing) and the user has to manually restart the stream. Issues #575, #449,
#458, #230, #103 all describe this.

**Solution:** Exponential-backoff reconnect (1s→2s→4s→8s→16s, max 5 attempts)
when the quit reason is transient (not user-stop, not server shutdown, not
auth failure). Emits `ReconnectAttempt` / `ReconnectSucceeded` / `ReconnectFailed`
signals for UI feedback.

**Key insight:** The session teardown/reinit cycle is already clean in
`lib/src/session.c` — we just need to call `chiaki_session_fini()` followed
by `chiaki_session_init()` + `chiaki_session_start()` with the same connect info.

**Files:** `gui/include/streamsession.h`, `gui/src/streamsession.cpp`

---

## 002 — JSON Status Output (--json-status)

**Problem:** When Cereal spawns chiaki.exe as a subprocess, there's no
structured way to know what's happening. The Electron parent has to parse
log lines or just guess when streaming starts/stops.

**Solution:** `--json-status` flag emits one-line JSON events to stdout:
```json
{"event":"connecting","host":"192.168.1.100","console":"PS5","timestamp_ms":1234567890}
{"event":"streaming","resolution":"1920x1080","codec":"h265","fps":60}
{"event":"quality","bitrate_mbps":42.5,"packet_loss":0.001,"fps_actual":59.8}
{"event":"disconnected","reason":"server_shutdown","was_error":false}
```

Trivially consumed from Node.js via `child.stdout.on('data', ...)`.

**Files:** `gui/src/main.cpp`, new `gui/include/jsonstatus.h`,
`gui/src/streamsession.cpp`

---

## 003 — Adaptive Bitrate Control

**Problem:** Static user-configured bitrate. If the network degrades, users
get stuttering and visual artifacts. They have to manually lower the bitrate
in settings and reconnect. Issues #575, #395, #516, #83, #519.

**Solution:** A background thread samples packet loss every 2 seconds:
- Packet loss >2% for 3 samples → reduce bitrate by 20% (floor: 5 Mbps)
- Packet loss <0.5% for 10 samples → increase bitrate by 10% (ceiling: user max)
- Uses the ctrl channel's "change quality" message to adjust mid-stream

The PS Remote Play protocol already supports dynamic bitrate changes — the
console's encoder adjusts within ~1 second of receiving the request.

**Files:** `lib/include/chiaki/streamconnection.h`, `lib/src/streamconnection.c`,
`lib/include/chiaki/session.h`, `gui/src/streamsession.cpp`

---

## 004 — Improved FEC Recovery and Decode Resilience

**Problem:** Periodic "green frames", "white flashes" during otherwise stable
streams. The existing FEC does XOR-based recovery but passes potentially
corrupted NAL units to FFmpeg, which can cascade into multiple bad frames.

**Solution:**
1. Validate NAL structure after FEC recovery — drop if invalid instead of
   showing garbage
2. Track consecutive decode errors — after 3 in a row, flush the FFmpeg
   decoder and request an IDR keyframe from the console
3. Rate-limit IDR requests (500ms cooldown) to avoid spamming the console
4. The combination means: isolated packet loss → FEC recovery (invisible),
   burst loss → fast IDR recovery (~500ms glitch instead of 2-5s)

**Files:** `lib/include/chiaki/frameprocessor.h`, `lib/src/frameprocessor.c`,
`lib/src/session.c`

---

## 005 — Launcher Integration Mode (--cereal-mode)

**Problem:** Several UX friction points when chiaki runs as a subprocess:
- Qt GUI window flashes briefly before streaming window opens
- No structured exit codes — parent can't distinguish "user quit" from
  "auth expired" from "console not found"
- Can't pass registration keys and auth tokens via CLI

**Solution:** `--cereal-mode` flag that implies `--fullscreen`, `--json-status`,
and `--exit-app-on-stream-exit`, plus:
- Suppresses the main Qt window entirely (goes straight to streaming)
- Accepts `--regist-key=` and `--morning=` for CLI-based auth
- Sets process exit code based on quit reason:
  - `0` = clean exit (user stopped or server shutdown)
  - `1` = transient error (worth auto-retrying)
  - `2` = auth error (needs re-registration)
  - `3` = console not found

The Electron launcher reads these exit codes to decide what to show the user.

**Files:** `gui/src/main.cpp`, `gui/include/streamsession.h`

---

## 006 — Windows Hardware Decode and Latency Optimization

**Problem:** Windows users report higher latency than Linux. FFmpeg's
auto-detection doesn't always pick the best hardware decoder, and the decode
context isn't configured for minimum latency.

**Solution:**
1. Explicitly prefer D3D11VA → DXVA2 → CUDA (ordered by latency)
2. Set `AV_CODEC_FLAG_LOW_DELAY` and `AV_CODEC_FLAG2_FAST`
3. Single-thread decode (eliminates frame reordering delay)
4. Skip loop filter on non-reference frames (~15% faster decode)
5. Track decode-to-present latency for monitoring

**Files:** `gui/src/videodecoder.cpp` (or equivalent FFmpeg context setup),
`lib/src/videoreceiver.c`

---

## Implementation Priority

For the Cereal launcher, implement in this order:

1. **005 (Launcher mode)** — Eliminates the biggest UX friction immediately
2. **002 (JSON status)** — Enables the launcher to show real-time stream info
3. **001 (Auto-reconnect)** — Fixes the #1 user complaint
4. **006 (Windows HW decode)** — Performance improvement for the target platform
5. **004 (FEC recovery)** — Visual quality improvement
6. **003 (Adaptive bitrate)** — Most complex, biggest quality-of-life improvement

Patches 005 and 002 can be implemented in an afternoon. Patch 001 is a
medium effort. Patches 003, 004, and 006 require deeper testing with actual
PS4/PS5 hardware.

## AGPL Compliance

All patches must be published (AGPL v3 requirement). They're documented here
and the modified source is available via the git submodule + patch directory.
