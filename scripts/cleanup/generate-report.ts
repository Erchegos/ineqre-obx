#!/usr/bin/env tsx
/**
 * Generate a comprehensive cleanup report from all analysis tools
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const REPORTS_DIR = path.join(process.cwd(), 'cleanup-reports');
const OUTPUT_FILE = path.join(REPORTS_DIR, 'CLEANUP_REPORT.md');

interface CleanupData {
  unusedExports: string[];
  unusedDeps: { dependencies: string[]; devDependencies: string[] };
  unimportedFiles: string[];
  lintIssues: number;
}

async function loadReportData(): Promise<CleanupData> {
  const data: CleanupData = {
    unusedExports: [],
    unusedDeps: { dependencies: [], devDependencies: [] },
    unimportedFiles: [],
    lintIssues: 0,
  };

  // Load unused exports
  const exportsFile = path.join(REPORTS_DIR, 'unused-exports.txt');
  if (existsSync(exportsFile)) {
    const content = await fs.readFile(exportsFile, 'utf-8');
    data.unusedExports = content
      .split('\n')
      .filter(line => line.trim() && !line.includes('used in module'))
      .map(line => line.trim());
  }

  // Load unused dependencies
  const depsFile = path.join(REPORTS_DIR, 'unused-deps.json');
  if (existsSync(depsFile)) {
    const content = await fs.readFile(depsFile, 'utf-8');
    const parsed = JSON.parse(content);
    data.unusedDeps = {
      dependencies: parsed.dependencies || [],
      devDependencies: parsed.devDependencies || [],
    };
  }

  // Load unimported files
  const filesFile = path.join(REPORTS_DIR, 'unimported-files.txt');
  if (existsSync(filesFile)) {
    const content = await fs.readFile(filesFile, 'utf-8');
    data.unimportedFiles = content
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('summary') && !line.includes('unresolved'))
      .map(line => line.trim());
  }

  // Load lint issues
  const lintFile = path.join(REPORTS_DIR, 'lint-issues.json');
  if (existsSync(lintFile)) {
    const content = await fs.readFile(lintFile, 'utf-8');
    const parsed = JSON.parse(content);
    data.lintIssues = parsed.reduce((sum: number, file: any) => sum + (file.errorCount + file.warningCount), 0);
  }

  return data;
}

function generateMarkdownReport(data: CleanupData): string {
  const date = new Date().toISOString().split('T')[0];

  return `# Codebase Cleanup Report

Generated: ${date}

## Summary

- **Unused Exports**: ${data.unusedExports.length}
- **Unused Dependencies**: ${data.unusedDeps.dependencies.length + data.unusedDeps.devDependencies.length}
- **Unimported Files**: ${data.unimportedFiles.length}
- **Lint Issues**: ${data.lintIssues}

---

## 1. Unused Exports

${data.unusedExports.length > 0 ? data.unusedExports.slice(0, 50).map(exp => `- ${exp}`).join('\n') : 'None found'}

${data.unusedExports.length > 50 ? `\n... and ${data.unusedExports.length - 50} more\n` : ''}

---

## 2. Unused Dependencies

### Dependencies
${data.unusedDeps.dependencies.length > 0 ? data.unusedDeps.dependencies.map(dep => `- ${dep}`).join('\n') : 'None found'}

### Dev Dependencies
${data.unusedDeps.devDependencies.length > 0 ? data.unusedDeps.devDependencies.map(dep => `- ${dep}`).join('\n') : 'None found'}

---

## 3. Unimported Files

${data.unimportedFiles.length > 0 ? data.unimportedFiles.slice(0, 30).map(file => `- ${file}`).join('\n') : 'None found'}

${data.unimportedFiles.length > 30 ? `\n... and ${data.unimportedFiles.length - 30} more\n` : ''}

---

## 4. Next Steps

1. Review unused exports - may indicate dead code
2. Remove unused dependencies to reduce bundle size
3. Check unimported files - candidates for archival
4. Fix lint issues with \`pnpm run lint --fix\`

## Action Items

- [ ] Archive old migration scripts: \`pnpm run cleanup:archive --dry-run\`
- [ ] Remove unused dependencies: \`pnpm remove [package-name]\`
- [ ] Delete or archive unimported files
- [ ] Remove unused exports

---

For detailed cleanup process, see: \`docs/CLEANUP_GUIDE.md\`
`;
}

async function main() {
  console.log('Generating cleanup report...\n');

  // Ensure reports directory exists
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const data = await loadReportData();
  const report = generateMarkdownReport(data);

  await fs.writeFile(OUTPUT_FILE, report);

  console.log(`✅ Cleanup report generated: ${OUTPUT_FILE}\n`);
  console.log('Summary:');
  console.log(`  - Unused exports: ${data.unusedExports.length}`);
  console.log(`  - Unused dependencies: ${data.unusedDeps.dependencies.length + data.unusedDeps.devDependencies.length}`);
  console.log(`  - Unimported files: ${data.unimportedFiles.length}`);
  console.log(`  - Lint issues: ${data.lintIssues}`);
}

main().catch(console.error);
