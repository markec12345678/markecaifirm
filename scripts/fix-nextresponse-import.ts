// Post-fix: ensure NextResponse is imported in any route.ts that uses it.

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve('src/app/api');

function hasNextResponseImport(content: string): boolean {
  return /import\s+\{[^}]*\bNextResponse\b[^}]*\}\s+from\s+['"]next\/server['"]/.test(content);
}

function usesNextResponse(content: string): boolean {
  // Look for NextResponse usage in code (not in import lines).
  // Simple heuristic: \bNextResponse\b followed by .json or .next or .redirect etc.
  return /\bNextResponse\s*\./.test(content);
}

function addImportNamed(
  content: string,
  named: string,
  fromModule: string
): string {
  const existing = new RegExp(
    `(import\\s*\\{)([^}]*)(\\}\\s*from\\s*['"]${fromModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"])`
  );
  if (existing.test(content)) {
    const m = content.match(existing);
    if (m && new RegExp(`\\b${named}\\b`).test(m[2])) return content;
    return content.replace(existing, (_full, p1, p2, p3) => {
      const names = p2.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (names.includes(named)) return _full;
      names.push(named);
      const formatted = ' ' + names.join(', ') + ' ';
      return p1 + formatted + p3;
    });
  }
  // Find last import statement and insert after
  const lines = content.split('\n');
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\s*import\s+/)) {
      lastImportIdx = i;
    } else if (lastImportIdx >= 0 && lines[i].trim() === '') {
      // allow blank lines between imports
      continue;
    } else if (lastImportIdx >= 0) {
      break;
    }
  }
  const importLine = `import { ${named} } from '${fromModule}';`;
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importLine);
    return lines.join('\n');
  }
  return importLine + '\n\n' + content;
}

function walk(dir: string, files: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, files);
    else if (e.name === 'route.ts') files.push(full);
  }
}

const files: string[] = [];
walk(SRC_ROOT, files);

let fixed = 0;
for (const f of files) {
  if (f.includes('[...path]')) continue;
  const content = fs.readFileSync(f, 'utf8');
  if (!hasNextResponseImport(content) && usesNextResponse(content)) {
    const newContent = addImportNamed(content, 'NextResponse', 'next/server');
    fs.writeFileSync(f, newContent);
    console.log('Fixed NextResponse import in:', f);
    fixed++;
  }
}
console.log(`Total files fixed: ${fixed}`);
