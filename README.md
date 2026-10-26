# PII Scanner Agent

A desktop application (Electron) that scans documents for possible personal
information and lets administrators manage local records and custom detection rules.

## Features
- Scan documents, spreadsheets, text, logs, code, config files, ZIP archives and images (OCR)
- Scan single files, folders or whole local drives
- Built-in detection: email, phone, Aadhaar-like, PAN-like, IPv4, credit-card-like, date of birth
- Custom detection types created from a regex or an example value
- Unique PII count after each scan
- Admin panel with local SQLite database and audit logs
- Export scan results to CSV

## Run locally
    npm install
    npm start

## Privacy notice
Use fictional data while developing. Real personal information needs access
controls, encryption, secure backups and a retention policy.