# Project IRC CES

**Project IRC CES** is a desktop-based application designed to assist with the processing, management, and generation of **School Governance and Operations Division (SGOD)** documents and reports.

The application provides a centralized interface for working with report cards, forms, and related documents.

---

## Features

- **Individual Report Card (IRC)** processing
- Support for multiple **IRC forms and sections**
- **PMCF** and **TA Feedback Report** document processing
- Upload and processing of supported documents
- Local data storage using **SQLite**
- Desktop application interface
- No Python installation required when using the compiled Windows executable

---

## Download

The latest compiled version of Project IRC CES is available through the project's **GitHub Releases**.

Download the latest:

```text
Project-IRC-CES.exe
```

## Technologies

- **Python**
- **Flask**
- **PyWebView**
- **SQLite**
- **HTML / CSS / JavaScript**
- **PyInstaller**

## Compile Command

- python -m PyInstaller --clean --onefile --windowed --name SGOD_IRC_JHO --icon="static/images/Project_IRC.ico" --add-data "templates;templates" --add-data "static;static" --hidden-import webview --collect-all pdfplumber --collect-all pdfminer --collect-all pypdfium2 main.py
