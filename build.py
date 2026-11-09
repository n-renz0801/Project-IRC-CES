r"""
Clean build for Project-IRC-CES (PyInstaller, one-file windowed exe).

HOW TO RUN (works from any directory; uses this project's own env):
    python "C:\Users\Renz\Documents\Personal\Codes\SGOD_Projects\Project-IRC-CES\build.py"

Or, from inside the project folder:
    python build.py

What it does: deletes build\, dist\, Project-IRC-CES.spec and the old spec
(SGOD_IRC_JHO.spec), runs PyInstaller, then checks dist\Project-IRC-CES.exe exists.
Close the running app first, or the delete step will fail.
It never touches Git; commit the spec rename yourself.
To add a PyInstaller option later, edit EXTRA (or the args list) below,
and update the README command to match.
"""
import shutil
import subprocess
import sys
from pathlib import Path

PROJ = Path(__file__).resolve().parent
NAME = "Project-IRC-CES"
ENTRY = "main.py"
ICON = "static/images/Project_IRC.ico"
OLD_SPEC = "SGOD_IRC_JHO.spec"
EXTRA = ["--collect-all", "pdfplumber", "--collect-all", "pdfminer", "--collect-all", "pypdfium2"]

PY = PROJ / "env" / "Scripts" / "python.exe"


def fail(msg):
    print("ERROR: " + msg)
    sys.exit(1)


def main():
    for need in (PY, PROJ / ENTRY, PROJ / ICON):
        if not need.exists():
            fail("Missing: " + str(need))

    # 1. Clean
    for t in ("build", "dist", NAME + ".spec", OLD_SPEC):
        p = PROJ / t
        if not p.exists():
            continue
        try:
            if p.is_dir():
                shutil.rmtree(p)
            else:
                p.unlink()
        except OSError as e:
            fail("Could not delete %s. Is the app still running? %s" % (t, e))
        print("Removed " + t)

    # 2. Build
    cmd = [str(PY), "-m", "PyInstaller", "--clean", "--onefile", "--windowed",
           "--name", NAME, "--icon", ICON,
           "--add-data", "templates;templates", "--add-data", "static;static",
           "--hidden-import", "webview"] + EXTRA + [ENTRY]
    result = subprocess.run(cmd, cwd=str(PROJ))
    if result.returncode != 0:
        fail("PyInstaller failed (exit code %d)" % result.returncode)

    # 3. Verify
    exe = PROJ / "dist" / (NAME + ".exe")
    if not exe.exists():
        fail("Build finished but %s was not created" % exe)
    print("Built: %s (%.1f MB)" % (exe, exe.stat().st_size / 1048576))

    # 4. Read-only Git view
    try:
        print("Git view (read-only):")
        subprocess.run(["git", "-C", str(PROJ), "status", "--short"])
    except OSError:
        pass


if __name__ == "__main__":
    main()