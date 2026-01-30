# Codebase Cleanup Guide

Periodic manual cleanup guide for identifying and removing dead code, unused imports, and one-off scripts from the InEqRe_OBX project.

## Quick Start

Run the full analysis:
```bash
cd InEqRe_OBX
pnpm install  # Install cleanup dependencies if first time
pnpm run cleanup:analyze
pnpm run cleanup:report
```

Review the generated report:
```bash
cat cleanup-reports/CLEANUP_REPORT.md
```

---

## Analysis Tools

The cleanup system uses four complementary analysis tools:

### 1. Unused Exports (ts-prune)

**What it finds**: TypeScript exports that are declared but never imported anywhere in the codebase.

**Run it**:
```bash
pnpm run cleanup:exports
```

**Output**: `cleanup-reports/unused-exports.txt`

**What to do**: Review each unused export. If it's truly unused, remove the export or the entire function/class/variable.

### 2. Unused Imports (ESLint)

**What it finds**: Import statements that are imported but never used in the file.

**Run it**:
```bash
pnpm run cleanup:lint
```

**Auto-fix**:
```bash
pnpm run lint --fix
```

**Output**: `cleanup-reports/lint-issues.json`

**What to do**: Run auto-fix first, then manually review remaining issues.

### 3. Unused Dependencies (depcheck)

**What it finds**: npm packages in package.json that are installed but never imported.

**Run it**:
```bash
pnpm run cleanup:deps
```

**Output**: `cleanup-reports/unused-deps.json`

**What to do**: Verify the package is truly unused (check with `grep -r "package-name" .`), then remove:
```bash
pnpm remove package-name
```

### 4. Unimported Files (unimported)

**What it finds**: Files in your codebase that are never imported by any other file.

**Run it**:
```bash
pnpm run cleanup:files
```

**Output**: `cleanup-reports/unimported-files.txt`

**What to do**: Review each file. Archive old scripts, delete truly unused files, or add to entry points config if needed.

---

## Cleanup Process

Follow this four-phase process for safe, systematic cleanup:

### Phase 1: Analysis (Week 1, Day 1-2)

**Goal**: Generate comprehensive analysis of unused code

1. Install cleanup dependencies (first time only):
   ```bash
   pnpm install
   ```

2. Run full analysis:
   ```bash
   pnpm run cleanup:analyze
   ```

3. Generate consolidated report:
   ```bash
   pnpm run cleanup:report
   ```

4. Review the report:
   ```bash
   cat cleanup-reports/CLEANUP_REPORT.md
   ```

### Phase 2: Scripts Cleanup (Week 1, Day 3-5)

**Goal**: Archive old one-off migration scripts

1. Identify candidates for archival:
   ```bash
   pnpm run cleanup:archive --dry-run
   ```

2. Review the list carefully:
   - Scripts in `fx/` and `ibkr/` subdirectories are kept (active automation)
   - Scripts matching patterns like `fix-*`, `check-*`, `reimport-*` are candidates
   - Verify each script is truly one-off and completed

3. Archive old scripts:
   ```bash
   pnpm run cleanup:archive --auto
   ```

4. Scripts are moved to `scripts/archive/[category]/`, not deleted

### Phase 3: Code Cleanup (Week 2)

**Goal**: Remove unused code from the active codebase

1. **Fix unused imports** (auto-fixable):
   ```bash
   pnpm run lint --fix
   ```

2. **Remove unused exports**:
   - Review `cleanup-reports/unused-exports.txt`
   - Manually remove exports that are truly unused
   - Be careful with exports used by external consumers

3. **Remove unused dependencies**:
   - Review `cleanup-reports/unused-deps.json`
   - Verify with: `grep -r "package-name" .`
   - Remove: `pnpm remove package-name`

4. **Handle unimported files**:
   - Review `cleanup-reports/unimported-files.txt`
   - Delete if truly unused
   - Archive if old test/migration files
   - Keep if entry points (pages, API routes)

### Phase 4: Verification (Week 3)

**Goal**: Ensure cleanup didn't break anything

1. **Re-run analysis**:
   ```bash
   pnpm run cleanup:analyze
   pnpm run cleanup:report
   ```

   Verify counts have decreased.

2. **Build check**:
   ```bash
   pnpm run build
   ```

   Ensure build succeeds.

3. **Type check**:
   ```bash
   pnpm run typecheck
   ```

   Ensure no type errors.

4. **Manual smoke test**: Test key functionality in the application.

5. **Commit changes**:
   ```bash
   git add -A
   git commit -m "Cleanup: Remove unused code and archive old scripts"
   ```

---

## Scripts Directory Management

The `scripts/` directory contains both active automation scripts and one-off migration scripts.

### Categories

**Keep - Active Automation**:
- `scripts/fx/` - FX rate fetching and updates
- `scripts/ibkr/` - Interactive Brokers data imports
- `scripts/cleanup/` - Cleanup utilities

**Archive - One-off Migrations**:
- `fix-*` - Data fixes (e.g., `fix-text-encoding.js`)
- `check-*` - Validation scripts (e.g., `check-duplicates.js`)
- `reimport-*` - One-time imports (e.g., `reimport-dnb.js`)
- `migrate-*` - Data migrations (e.g., `migrate-pdfs-bucket.js`)
- `test-*` - One-off tests (e.g., `test-clean-summaries.js`)

### Archive Process

1. **Identify**: Scripts matching patterns above
2. **Categorize**: By type (fixes, checks, imports, migrations)
3. **Archive**: Move to `scripts/archive/[category]/`
4. **Document**: Manifest saved to `scripts/archive/manifest.json`

Archived scripts can be restored easily:
```bash
mv scripts/archive/fixes/fix-something.js scripts/
```

---

## Safety Checklist

Before any cleanup, ensure:

- [ ] Create git commit: `git commit -m "Checkpoint before cleanup"`
- [ ] Run full test suite (if tests exist)
- [ ] Verify build succeeds: `pnpm run build`
- [ ] Review active scripts documentation in `scripts/README.md`
- [ ] Use `--dry-run` mode first for archive operations

### Archive Safety

- Scripts are **moved**, not deleted
- Archive includes README and manifest for reference
- Easy restoration process
- Organized by category for quick finding

### Dependency Safety

- Always verify with: `grep -r "package-name" .`
- Review devDependencies separately from dependencies
- Keep TypeScript `@types/*` packages even if unused by depcheck
- Keep build tools (turbo, typescript, eslint, prettier)

---

## Periodic Maintenance Schedule

### Quarterly Cleanup (Every 3 months)

1. Run full analysis: `pnpm run cleanup:analyze`
2. Archive old scripts: `pnpm run cleanup:archive --dry-run`
3. Review and remove unused dependencies
4. Update `scripts/README.md` documentation

### Monthly Checks (First Monday of month)

1. Run lint: `pnpm run lint`
2. Check for new one-off scripts in `scripts/` directory
3. Update active scripts documentation

### Continuous Prevention

- **ESLint** catches unused imports on save (if configured in IDE)
- **TypeScript** catches unused variables during development
- **Code review** checklist includes checking for cleanup needs

---

## Automation Prevention

The cleanup system includes ongoing prevention mechanisms:

### ESLint Rules

Configured in [apps/web/eslint.config.mjs](InEqRe_OBX/apps/web/eslint.config.mjs):

- `unused-imports/no-unused-imports` - Warns on unused imports
- `unused-imports/no-unused-vars` - Warns on unused variables
- `@typescript-eslint/no-unused-vars` - TypeScript unused var detection
- `no-unused-expressions` - Catches commented-out code patterns
- `no-unreachable` - Catches unreachable code

### TypeScript Strict Mode

Enabled in all `tsconfig.json` files:
- Catches unused local variables
- Enforces explicit types
- Prevents implicit any

### Pre-commit Hooks (Optional)

Consider adding pre-commit hooks with `husky`:
```bash
pnpm add -D husky lint-staged
```

Configure `.husky/pre-commit`:
```bash
#!/bin/sh
pnpm run lint
pnpm run typecheck
```

---

## Configuration Files

The cleanup system uses these configuration files:

- [`.depcheckrc.json`](InEqRe_OBX/.depcheckrc.json) - Depcheck config
- [`.unimportedrc.json`](InEqRe_OBX/.unimportedrc.json) - Unimported config
- [`ts-prune.json`](InEqRe_OBX/ts-prune.json) - ts-prune config
- [`eslint.config.mjs`](InEqRe_OBX/eslint.config.mjs) - Root ESLint config

These files configure which files to ignore and what patterns to check.

---

## Troubleshooting

### "Command not found: ts-prune"

**Solution**: Install dependencies first:
```bash
pnpm install
```

### "cleanup-reports directory doesn't exist"

**Solution**: It's auto-created. Ensure it's in `.gitignore`:
```bash
echo "cleanup-reports/" >> .gitignore
```

### "Too many unused exports reported"

**Cause**: Some exports are used by entry points (Next.js pages, API routes).

**Solution**: These are configured to be ignored in `ts-prune.json`. If legitimate exports are flagged, add them to the ignore list.

### "Depcheck reports false positives"

**Cause**: Some packages are used indirectly or via config files.

**Solution**: Add them to `ignoreMatches` in `.depcheckrc.json`.

---

## Additional Resources

- [scripts/README.md](InEqRe_OBX/scripts/README.md) - Scripts directory documentation
- [scripts/archive/README.md](InEqRe_OBX/scripts/archive/README.md) - Archive documentation
- `cleanup-reports/CLEANUP_REPORT.md` - Latest cleanup analysis report

---

## Questions?

For questions or issues with the cleanup process, review this guide or check the configuration files linked above.
