# Software Billing - Offline Windows Billing Software

A complete offline Windows billing software built with Electron, HTML, CSS, and JavaScript. This application allows you to create, manage, and print invoices without requiring an internet connection.

## Features

- ✅ **Fully Offline** - Works completely offline, no internet connection required
- ✅ **Invoice Management** - Create, edit, view, and delete invoices
- ✅ **Customer Management** - Add and manage customer information
- ✅ **Product Management** - Add and manage products with HSN codes
- ✅ **Tax Calculations** - Automatic SGST, CGST, and IGST calculations
- ✅ **Invoice Printing** - Print professional invoices matching your requirements
- ✅ **SQLite Database** - Local database for data storage
- ✅ **Secure IPC** - Context isolation enabled for security
- ✅ **Modern UI** - Clean and intuitive billing counter interface

## Prerequisites

Before you begin, ensure you have the following installed:

1. **Node.js** (v16 or higher)
   - Download from: https://nodejs.org/
   - Verify installation: `node --version`
   - Verify npm: `npm --version`

2. **Git** (optional, for cloning)
   - Download from: https://git-scm.com/

## Installation Steps

### Step 1: Install Node.js

1. Visit https://nodejs.org/
2. Download the LTS (Long Term Support) version for Windows
3. Run the installer and follow the setup wizard
4. Make sure to check "Add to PATH" during installation
5. Restart your computer after installation

### Step 2: Install Dependencies

1. Open Command Prompt or PowerShell in the project directory
2. Run the following command:

```bash
npm install
```

This will install all required dependencies:
- Electron (latest stable version)
- better-sqlite3 (SQLite database - fast, synchronous)
- electron-builder (for building Windows EXE)

**Note:** The installation may take a few minutes. `better-sqlite3` version 11.6.0+ includes prebuilt binaries for Node.js v24, so no compilation is needed. If you encounter compilation errors, you may need to install build tools:
- Install Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
- Or install Python 2.7 (for node-gyp)

### Step 3: Run the Application

To start the application in development mode:

```bash
npm start
```

The application window should open automatically.

## Building Windows EXE

To create a Windows executable file:

### Step 1: Build the Application

```bash
npm run build
```

Or specifically for Windows:

```bash
npm run build:win
```

### Step 2: Find the Executable

After building, you can find the executable in:
- `dist/Software Billing Setup X.X.X.exe` - Installer version
- `dist/win-unpacked/Software Billing.exe` - Portable version

### Step 3: Distribution

- **Installer**: Use the `.exe` installer to distribute the application
- **Portable**: Copy the entire `win-unpacked` folder for a portable version

## Project Structure

```
software-billing/
├── main.js              # Electron main process
├── preload.js           # Preload script for secure IPC
├── database.js          # SQLite database operations
├── index.html           # Main HTML file
├── renderer.js          # Frontend JavaScript logic
├── styles.css           # CSS styling
├── package.json         # Project configuration
└── README.md           # This file
```

## Database Schema

The application uses SQLite with the following tables:

- **company_settings** - Company/business information
- **customers** - Customer details
- **products** - Product catalog with HSN codes
- **invoices** - Invoice headers
- **invoice_items** - Invoice line items

## Usage Guide

### 1. Configure Company Settings

1. Click the **Settings** button in the header
2. Enter your company details:
   - Company Name
   - GSTIN
   - Mobile Number
   - Address
   - Email
   - Bank Details (Name, Account Number, IFSC Code)
   - Terms & Conditions
3. Click **Save Settings**

### 2. Add Customers

1. Click the **Customers** button
2. Click **+ Add New Customer**
3. Fill in customer details:
   - Name (required)
   - GSTIN
   - Mobile
   - Address
   - State
   - Pincode
4. Click **Save Customer**

### 3. Add Products

1. Click the **Products** button
2. Click **+ Add New Product**
3. Fill in product details:
   - Name (required)
   - HSN Code
   - Unit (default: CBM)
   - Rate (required)
4. Click **Save Product**

### 4. Create Invoice

1. The invoice number is auto-generated
2. Select invoice date and time
3. Enter TP Number and Vehicle Number (optional)
4. Select a customer from the dropdown
5. Click **+ Add Item** to add products
6. For each item:
   - Select product
   - Enter quantity
   - Rate is auto-filled (can be modified)
   - Amount is calculated automatically
7. Adjust tax rates if needed (default: SGST 2.5%, CGST 2.5%, IGST 0%)
8. Enter additional charges if any (Royalty, DMFT, Reverse Charge)
9. Click **Save Invoice** to save
10. Click **Print Invoice** to print

### 5. View/Manage Invoices

1. Click the **Invoices** button
2. View all saved invoices
3. Click **View** to load an invoice for editing
4. Click **Delete** to remove an invoice

## Sample Data

The application comes with sample data:
- **Company**: AMRIT CONSTRUCTIONS COMPANY
- **Customer**: HABIBULLAH TRADERS
- **Product**: 40MM (Rate: 820, HSN: 25171010)
- **Sample Invoice**: 25-26-2792

You can modify or delete this sample data as needed.

## Technical Details

### Security

- **Context Isolation**: Enabled (`contextIsolation: true`)
- **Node Integration**: Disabled (`nodeIntegration: false`)
- **Secure IPC**: All communication through `contextBridge`

### Database Location

The SQLite database is stored in the user's app data directory:
- Windows: `%APPDATA%\software-billing\billing.db`

### Supported Formats

- Invoice Number: Auto-generated (format: YYYY-YYYY-NNNN)
- Date Format: ISO 8601 (stored), Locale format (displayed)
- Currency: Indian Rupees (₹)
- Tax: SGST, CGST, IGST support

## Troubleshooting

### Issue: `better-sqlite3` compilation errors

**Solution**: If you get C++ compilation errors, ensure you have:
1. Visual Studio Build Tools 2022 installed
2. Node.js v24.11.1 or later (we use version 11.6.0+ which has prebuilt binaries)
3. If issues persist, try: `npm install better-sqlite3@latest`

### Issue: `better-sqlite3` installation fails

**Solution**: Install build tools:
1. Install Visual Studio Build Tools
2. Or install Python 2.7
3. Run `npm install` again

### Issue: Application won't start

**Solution**:
1. Check Node.js version: `node --version` (should be v16+)
2. Delete `node_modules` folder
3. Run `npm install` again
4. Check for error messages in console

### Issue: Database errors

**Solution**:
1. Close the application
2. Delete the database file (if corrupted)
3. Restart the application (new database will be created)

### Issue: Build fails

**Solution**:
1. Ensure all dependencies are installed: `npm install`
2. Check electron-builder version
3. Try: `npm run build:win -- --win nsis`

## Development

### Running in Development Mode

```bash
npm start
```

### Debugging

To open DevTools, uncomment this line in `main.js`:
```javascript
mainWindow.webContents.openDevTools();
```

## License

MIT License - Feel free to use and modify as needed.

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review the code comments
3. Check Electron documentation: https://www.electronjs.org/

## Version

Current Version: 1.0.0

---

**Note**: This is a demo application. For production use, consider adding:
- Data backup functionality
- Export to PDF/Excel
- User authentication
- Multi-user support
- Advanced reporting

