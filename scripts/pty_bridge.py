#!/usr/bin/env python3

import errno
import fcntl
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

    selector = selectors.DefaultSelector()
    selector.register(master_fd, selectors.EVENT_READ, "pty")
    selector.register(sys.stdin.fileno(), selectors.EVENT_READ, "stdin")

    child_returncode = None

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

            if child_returncode is not None and master_fd not in selector.get_map():
                break
    finally:
        close_selector_fd(selector, master_fd)
        close_selector_fd(selector, sys.stdin.fileno())
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


def close_selector_fd(selector: selectors.BaseSelector, fd: int) -> None:
    try:
        selector.unregister(fd)
    except Exception:
        pass

    try:
        os.close(fd)
    except OSError:
        pass


def set_window_size(fd: int, rows: int, cols: int) -> None:
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    try:
        termios.tcsetwinsize(fd, (rows, cols))
    except AttributeError:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


if __name__ == "__main__":
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    raise SystemExit(main())
