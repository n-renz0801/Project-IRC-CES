"""
main.py -- Desktop entry point.

This is what gets run (and later, what PyInstaller packages) for the
installable desktop app. `python app.py` still works separately for
normal web-dev with the Flask dev server -- this file is additive, not
a replacement.

It starts the existing Flask `app` on a background thread using
Werkzeug's `run_simple` (no reloader, no debugger -- both break inside a
frozen exe, since the reloader spawns a second process), then opens a
native window pointed at it via pywebview.
"""
import socket
import sys
import threading
import time
import urllib.request

import webview

# When PyInstaller freezes this into a onefile exe, make sure app.py's
# own imports (models, storage) resolve from the same bundle.
if getattr(sys, "frozen", False):
    sys.path.insert(0, sys._MEIPASS)

from app import app, db, storage  # noqa: E402  (must come after the path fix above)


def _find_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _run_server(port):
    from werkzeug.serving import run_simple
    run_simple("127.0.0.1", port, app, threaded=True)


def _wait_until_up(port, timeout=10):
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/"
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=0.5)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    # Same one-time setup app.py's own __main__ block does for `python
    # app.py` -- repeated here since main.py is now the actual entry
    # point and that block never runs when app.py is imported instead
    # of executed directly.
    with app.app_context():
        db.create_all()
        storage.seed_schools()
        storage.seed_irc7_rows()

    port = _find_free_port()
    server_thread = threading.Thread(target=_run_server, args=(port,), daemon=True)
    server_thread.start()

    if not _wait_until_up(port):
        # Extremely unlikely, but surface it instead of opening a blank window.
        raise RuntimeError("Local server did not start in time.")

    webview.create_window(
        "SGOD IRC JHO",
        f"http://127.0.0.1:{port}/",
        width=1280,
        height=800,
        min_size=(1024, 700),
        maximized=True,
    )
    webview.start()


if __name__ == "__main__":
    main()