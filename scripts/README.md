# Scripts Directory

This directory contains utility scripts for data imports, migrations, and automated tasks for the InEqRe_OBX project.

## Directory Structure

```
scripts/
├── cleanup/              # Cleanup and maintenance utilities
│   ├── archive-old-scripts.ts
│   └── generate-report.ts
├── fx/                   # Foreign exchange rate scripts
│   └── fetch-fx-rates.ts
├── ibkr/                 # Interactive Brokers data import scripts
│   ├── import-ose-stocks.ts
│   └── [Python scripts for IBKR data]
├── archive/              # Archived one-off migration scripts
│   ├── fixes/
│   ├── checks/
│   ├── imports/
│   ├── migrations/
│   └── README.md
└── [One-off scripts]     # Scripts pending archival
```

---

## Active Scripts

These scripts are run regularly and should **never be archived**.

### Cleanup Utilities (`cleanup/`)

**Purpose**: Codebase cleanup and maintenance

- `archive-old-scripts.ts` - Archive old one-off migration scripts
- `generate-report.ts` - Generate consolidated cleanup reports

**Usage**:
```bash
# Archive old scripts (dry run)
pnpm run cleanup:archive --dry-run

# Generate cleanup report
pnpm run cleanup:report
```

### Foreign Exchange Scripts (`fx/`)

**Purpose**: Fetch and update foreign exchange rates

- `fetch-fx-rates.ts` - Fetch FX rates from external APIs

**Usage**:
```bash
tsx scripts/fx/fetch-fx-rates.ts
```

**Schedule**: Run daily or as needed

### Interactive Brokers Scripts (`ibkr/`)

**Purpose**: Import stock data and fundamentals from Interactive Brokers

- `import-ose-stocks.ts` - Import Oslo Stock Exchange stocks
- Python scripts for IBKR data fetching

**Usage**:
```bash
# Run via npm script
pnpm run import:ose

# Or directly
tsx scripts/ibkr/import-ose-stocks.ts
```

**Schedule**: Run weekly or as needed

---

## One-Off Scripts (Candidates for Archival)

These scripts were created for specific one-time tasks and may be candidates for archival.

### Data Fixes

Scripts that fix data issues (one-time corrections):

- `fix-*.ts/js` - Various data correction scripts
- Examples: `fix-text-encoding.js`, `fix-pdf-metadata.ts`

### Data Validation

Scripts that check data integrity (one-time validations):

- `check-*.ts/js` - Data validation scripts
- `verify-*.ts/js` - Verification scripts
- `test-*.ts/js` - One-off test scripts

### Data Imports

Scripts that import data once (completed migrations):

- `reimport-*.ts/js` - Re-import scripts
- `import-*.ts/js` - One-time import scripts
- `backfill-*.ts/js` - Backfill scripts

### Data Migrations

Scripts that migrate data structure (completed):

- `migrate-*.ts/js` - Migration scripts
- `update-*.ts/js` - Update scripts

---

## Archive Process

When a one-off script is completed and no longer needed:

1. **Identify**: Check if the script matches one-off patterns (fix-*, check-*, etc.)
2. **Verify**: Ensure the task is completed and won't need to run again
3. **Archive**: Run the archive command
   ```bash
   pnpm run cleanup:archive --dry-run  # Review first
   pnpm run cleanup:archive --auto     # Actually archive
   ```
4. **Result**: Script is moved to `scripts/archive/[category]/`

See [../docs/CLEANUP_GUIDE.md](../docs/CLEANUP_GUIDE.md) for detailed cleanup process.

---

## Creating New Scripts

### For Active Scripts

If creating a new regularly-run script:

1. Place in appropriate subdirectory (`fx/`, `ibkr/`, `cleanup/`)
2. Add shebang: `#!/usr/bin/env tsx`
3. Make executable: `chmod +x scripts/[subdirectory]/script-name.ts`
4. Document in this README
5. Add npm script to root `package.json` if needed

### For One-Off Scripts

If creating a one-off migration or fix script:

1. Use descriptive naming pattern:
   - `fix-[description].ts` - For data fixes
   - `check-[description].ts` - For validations
   - `reimport-[description].ts` - For re-imports
   - `migrate-[description].ts` - For migrations

2. Place in root `scripts/` directory

3. After completion, archive using:
   ```bash
   pnpm run cleanup:archive --auto
   ```

---

## Running Scripts

### Using tsx (Recommended)

```bash
tsx scripts/path/to/script.ts
```

### Using npm scripts

```bash
# Check package.json for available scripts
pnpm run import:ose
pnpm run cleanup:archive
```

### With arguments

```bash
tsx scripts/cleanup/archive-old-scripts.ts --dry-run
```

---

## Best Practices

1. **Name scripts descriptively** - Use clear, specific names
2. **Add comments** - Include purpose and usage at top of file
3. **Use TypeScript** - Prefer `.ts` over `.js` for type safety
4. **Handle errors** - Include proper error handling
5. **Log progress** - Use `console.log()` to show progress
6. **Archive when done** - Don't let one-off scripts accumulate

---

## Maintenance

### Quarterly Review

Every 3 months:

1. Review scripts in root directory
2. Identify one-off scripts that are completed
3. Run archive process
4. Update this README if needed

### Adding New Active Scripts

When adding new regularly-run scripts:

1. Create subdirectory if new category
2. Add script with clear documentation
3. Update this README under "Active Scripts"
4. Add npm script to `package.json` if appropriate

---

## Archive Manifest

The archive maintains a manifest of all archived scripts:

```bash
cat scripts/archive/manifest.json
```

This shows:
- Archive date
- Total scripts archived
- Breakdown by category
- Individual script details

---

## Questions?

For questions about:
- **Cleanup process**: See [../docs/CLEANUP_GUIDE.md](../docs/CLEANUP_GUIDE.md)
- **Archive structure**: See [archive/README.md](archive/README.md)
- **Specific scripts**: Check comments at top of script file
