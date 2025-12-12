# Applications Folder

This folder contains application submissions for AI licensing evaluation.

## Structure

Each application should be placed in its own subfolder:

```
applications/
  ├── APP-001-HTX-Global/
  │   ├── application.json
  │   ├── documents/
  │   │   ├── incorporation_certificate.pdf
  │   │   ├── license_documents.pdf
  │   │   └── compliance_reports.pdf
  │   └── metadata.json
  └── APP-002-CompanyName/
      └── ...
```

## Application JSON Format

```json
{
  "id": "VASP-2025-001",
  "companyName": "Company Name",
  "applicationDate": "2025-12-09",
  "appName": "Application Name",
  "appVendor": "Vendor Name",
  "appVersion": "1.0.0",
  "appDescription": "Description...",
  "aiCapabilities": ["capability1", "capability2"],
  "dataUsage": "Description of data usage",
  "businessPlan": "Detailed business plan...",
  "regulatoryHistory": "Regulatory history...",
  "technicalArchitecture": "Technical details..."
}
```

The backend will automatically scan this folder and evaluate applications.
