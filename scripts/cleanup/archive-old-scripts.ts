#!/usr/bin/env tsx
/**
 * Archive old one-off migration scripts to scripts/archive/
 * This script identifies completed migration scripts and moves them to archive
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
const ARCHIVE_DIR = path.join(SCRIPTS_DIR, 'archive');
const ARCHIVE_CATEGORIES = ['fixes', 'checks', 'imports', 'migrations'] as const;

// Patterns that indicate one-off migration scripts
const MIGRATION_PATTERNS = [
  /^fix-.*\.(ts|js|mjs)$/,
  /^check-.*\.(ts|js|mjs)$/,
  /^test-.*\.(ts|js|mjs)$/,
  /^reimport-.*\.(ts|js|mjs)$/,
  /^verify-.*\.(ts|js|mjs)$/,
  /^search-.*\.(ts|js|mjs)$/,
  /^update-.*\.(ts|js|mjs)$/,
  /^migrate-.*\.(ts|js|mjs)$/,
  /^backfill-.*\.(ts|js|mjs)$/,
];

// Active scripts to NEVER archive
const KEEP_SCRIPTS = [
  'scripts/fx/',
  'scripts/ibkr/',
  'scripts/cleanup/',
];

interface ScriptInfo {
  filename: string;
  fullPath: string;
  category: string;
  lastModified: Date;
}

async function ensureArchiveStructure() {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  for (const category of ARCHIVE_CATEGORIES) {
    await fs.mkdir(path.join(ARCHIVE_DIR, category), { recursive: true });
  }

  // Create archive README
  const readme = `# Archived Scripts

This directory contains one-off migration and fix scripts that have been completed.
Scripts are categorized by type:

- **fixes/**: One-time data fixes and corrections
- **checks/**: Data validation scripts
- **imports/**: One-time import scripts
- **migrations/**: Database and data migrations

## Restoration

To restore a script from archive:
\`\`\`bash
mv archive/[category]/[script-name] ./
\`\`\`

## Archive Date
Archived on: ${new Date().toISOString().split('T')[0]}
`;

  await fs.writeFile(path.join(ARCHIVE_DIR, 'README.md'), readme);
}

async function categorizeScript(filename: string): Promise<string | null> {
  if (filename.startsWith('fix-')) return 'fixes';
  if (filename.startsWith('check-') || filename.startsWith('verify-')) return 'checks';
  if (filename.startsWith('reimport-') || filename.startsWith('backfill-') || filename.startsWith('import-')) return 'imports';
  if (filename.startsWith('migrate-') || filename.startsWith('update-')) return 'migrations';
  return null;
}

async function findMigrationScripts(): Promise<ScriptInfo[]> {
  const scripts: ScriptInfo[] = [];
  const files = await fs.readdir(SCRIPTS_DIR);

  for (const file of files) {
    const fullPath = path.join(SCRIPTS_DIR, file);
    const stat = await fs.stat(fullPath);

    if (!stat.isFile()) continue;

    // Check if matches migration pattern
    const isMigration = MIGRATION_PATTERNS.some(pattern => pattern.test(file));
    if (!isMigration) continue;

    // Check if in keep list
    const shouldKeep = KEEP_SCRIPTS.some(keep => fullPath.includes(keep));
    if (shouldKeep) continue;

    const category = await categorizeScript(file);
    if (!category) continue;

    scripts.push({
      filename: file,
      fullPath,
      category,
      lastModified: stat.mtime,
    });
  }

  return scripts.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
}

async function archiveScript(script: ScriptInfo, dryRun: boolean = true): Promise<void> {
  const archivePath = path.join(ARCHIVE_DIR, script.category, script.filename);

  if (dryRun) {
    console.log(`[DRY RUN] Would archive: ${script.filename} -> archive/${script.category}/`);
    return;
  }

  await fs.rename(script.fullPath, archivePath);
  console.log(`Archived: ${script.filename} -> archive/${script.category}/`);
}

async function generateArchiveManifest(scripts: ScriptInfo[]) {
  const manifest = {
    archiveDate: new Date().toISOString(),
    totalScripts: scripts.length,
    byCategory: scripts.reduce((acc, script) => {
      acc[script.category] = (acc[script.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    scripts: scripts.map(s => ({
      filename: s.filename,
      category: s.category,
      lastModified: s.lastModified.toISOString(),
    })),
  };

  await fs.writeFile(
    path.join(ARCHIVE_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const autoArchive = process.argv.includes('--auto');

  console.log('='.repeat(70));
  console.log('ARCHIVE OLD MIGRATION SCRIPTS');
  console.log('='.repeat(70));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'ACTUAL'}\n`);

  await ensureArchiveStructure();
  const scripts = await findMigrationScripts();

  if (scripts.length === 0) {
    console.log('No migration scripts found to archive.');
    return;
  }

  console.log(`Found ${scripts.length} migration scripts:\n`);

  // Group by category
  const byCategory = scripts.reduce((acc, script) => {
    if (!acc[script.category]) acc[script.category] = [];
    acc[script.category].push(script);
    return acc;
  }, {} as Record<string, ScriptInfo[]>);

  for (const [category, categoryScripts] of Object.entries(byCategory)) {
    console.log(`\n${category.toUpperCase()} (${categoryScripts.length}):`);
    for (const script of categoryScripts) {
      const age = Math.floor((Date.now() - script.lastModified.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`  - ${script.filename} (last modified: ${age} days ago)`);
    }
  }

  if (!autoArchive && !dryRun) {
    console.log('\n⚠️  Review the list above. Run with --auto to archive these scripts.');
    console.log('Or run with --dry-run to see what would be archived.\n');
    return;
  }

  console.log('\nArchiving scripts...');
  for (const script of scripts) {
    await archiveScript(script, dryRun);
  }

  if (!dryRun) {
    await generateArchiveManifest(scripts);
    console.log(`\n✅ Archived ${scripts.length} scripts to ${ARCHIVE_DIR}`);
    console.log('Manifest saved to: archive/manifest.json');
  } else {
    console.log('\n[DRY RUN] No files were moved. Run without --dry-run to archive.');
  }
}

main().catch(console.error);
