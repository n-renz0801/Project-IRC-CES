import os

# Directories to completely ignore
SKIP_DIRS = {
    "env",
    "venv",
    ".venv",
    "__pycache__",
    ".git",
    ".idea",
    ".vscode",
    "node_modules",
    "site-packages",
    "dist",
    "build",
    "instance",
    "uploads",
    "logs",
    "backups",
    "archive",
    "archives",
    "migrations",
}

# Files to completely ignore
SKIP_FILES = {
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
}

# File extensions worth displaying
INCLUDE_EXTENSIONS = {
    # Python
    ".py",

    # Web
    ".html", ".htm", ".css", ".js",

    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".webp", ".ico", ".bmp", ".tiff",

    # Data and configuration
    ".json", ".toml", ".yaml", ".yml",
    ".ini", ".cfg", ".sql",

    # Documentation
    ".md", ".txt",

    # Other project files
    ".spec", ".bat", ".ps1",
}

# Important files without extensions or with special names
INCLUDE_FILES = {
    ".gitignore",
    ".env.example",
    "Dockerfile",
    "Procfile",
    "LICENSE",
    "Makefile",
}


def should_include_file(filename):
    if filename in SKIP_FILES:
        return False

    if filename in INCLUDE_FILES:
        return True

    _, ext = os.path.splitext(filename)

    return ext.lower() in INCLUDE_EXTENSIONS


def print_tree(root=".", prefix=""):
    entries = []

    for entry in sorted(os.listdir(root)):
        path = os.path.join(root, entry)

        if os.path.isdir(path):
            if entry not in SKIP_DIRS:
                # Only include directories containing relevant files
                entries.append((entry, path, True))

        elif should_include_file(entry):
            entries.append((entry, path, False))

    # Remove empty directories
    filtered_entries = []

    for name, path, is_dir in entries:
        if is_dir:
            if has_relevant_content(path):
                filtered_entries.append((name, path, True))
        else:
            filtered_entries.append((name, path, False))

    for index, (name, path, is_dir) in enumerate(filtered_entries):
        is_last = index == len(filtered_entries) - 1

        connector = "└── " if is_last else "├── "

        print(prefix + connector + name + ("/" if is_dir else ""))

        if is_dir:
            extension = "    " if is_last else "│   "
            print_tree(path, prefix + extension)


def has_relevant_content(root):
    for entry in os.listdir(root):
        path = os.path.join(root, entry)

        if os.path.isdir(path):
            if entry not in SKIP_DIRS and has_relevant_content(path):
                return True

        elif should_include_file(entry):
            return True

    return False


print(os.path.basename(os.path.abspath(os.getcwd())) + "/")
print_tree()