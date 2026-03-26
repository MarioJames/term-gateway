#!/usr/bin/env python3

import errno
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import subprocess
import sys
import termios

DEFAULT_COLS = int(os.environ.get("TERM_GATEWAY_PTY_COLS", "120"))
DEFAULT_ROWS = int(os.environ.get("TERM_GATEWAY_PTY_ROWS", "36"))
CONTROL_FD = 3


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pty_bridge.py <command> [args...]", file=sys.stderr)
        return 64

    master_fd, slave_fd = pty.openpty()
    set_window_size(slave_fd, DEFAULT_ROWS, DEFAULT_COLS)

    child = subprocess.Popen(
        sys.argv[1:],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        env={**os.environ, "TERM": os.environ.get("TERM", "xterm-256color")},
        start_new_session=True,
    )

    os.close(slave_fd)
    os.set_blocking(master_fd, False)
    os.set_blocking(sys.stdin.fileno(), False)
    control_fd = resolve_optional_fd(CONTROL_FD)
    if control_fd is not None:
        os.set_blocking(control_fd, False)

    selector = selectors.DefaultSelector()
    selector.register(master_fd, selectors.EVENT_READ, "pty")
    selector.register(sys.stdin.fileno(), selectors.EVENT_READ, "stdin")
    if control_fd is not None:
        selector.register(control_fd, selectors.EVENT_READ, "control")

    child_returncode = None
    control_buffer = bytearray()

    try:
        while True:
            if child_returncode is None:
                child_returncode = child.poll()

            events = selector.select(timeout=0.1)
            if not events and child_returncode is not None and master_fd not in selector.get_map():
                break

            for key, _ in events:
                if key.data == "pty":
                    if not forward_master_output(master_fd):
                        close_selector_fd(selector, master_fd)
                elif key.data == "stdin":
                    if not forward_stdin(master_fd):
                        close_selector_fd(selector, sys.stdin.fileno())
                elif key.data == "control":
                    if not forward_control_commands(control_fd, master_fd, control_buffer):
                        close_selector_fd(selector, control_fd)

            if child_returncode is not None and master_fd not in selector.get_map():
                break
    finally:
        close_selector_fd(selector, master_fd)
        close_selector_fd(selector, sys.stdin.fileno())
        if control_fd is not None:
            close_selector_fd(selector, control_fd)
        selector.close()

        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                child.kill()

    return child.wait()


def forward_master_output(master_fd: int) -> bool:
    try:
        data = os.read(master_fd, 65536)
    except OSError as error:
        return error.errno not in (errno.EIO, errno.EBADF)

    if not data:
        return False

    os.write(sys.stdout.fileno(), data)
    return True


def forward_stdin(master_fd: int) -> bool:
    try:
        data = os.read(sys.stdin.fileno(), 65536)
    except OSError as error:
        return error.errno not in (errno.EIO, errno.EBADF)

    if not data:
        return False

    os.write(master_fd, data)
    return True


def forward_control_commands(control_fd: int, master_fd: int, buffer: bytearray) -> bool:
    try:
        data = os.read(control_fd, 4096)
    except OSError as error:
        return error.errno not in (errno.EIO, errno.EBADF)

    if not data:
        return False

    buffer.extend(data)

    while True:
        newline_index = buffer.find(b"\n")
        if newline_index < 0:
            if len(buffer) > 65536:
                buffer.clear()
            return True

        line = bytes(buffer[:newline_index]).strip()
        del buffer[: newline_index + 1]

        if not line:
            continue

        handle_control_command(master_fd, line)


def close_selector_fd(selector: selectors.BaseSelector, fd: int) -> None:
    try:
        selector.unregister(fd)
    except Exception:
        pass

    try:
        os.close(fd)
    except OSError:
        pass


def handle_control_command(master_fd: int, raw_line: bytes) -> None:
    try:
        payload = json.loads(raw_line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return

    if not isinstance(payload, dict):
        return

    if payload.get("type") != "resize":
        return

    rows = sanitize_terminal_size(payload.get("rows"), DEFAULT_ROWS)
    cols = sanitize_terminal_size(payload.get("cols"), DEFAULT_COLS)
    set_window_size(master_fd, rows, cols)


def set_window_size(fd: int, rows: int, cols: int) -> None:
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    try:
        termios.tcsetwinsize(fd, (rows, cols))
    except AttributeError:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


def sanitize_terminal_size(value: object, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback

    return max(20, min(parsed, 400))


def resolve_optional_fd(fd: int) -> int | None:
    try:
        os.fstat(fd)
    except OSError:
        return None

    return fd


if __name__ == "__main__":
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    raise SystemExit(main())
