// One-off transformation script: adds try/catch + logger.error to API route handlers.
// Run: bun run scripts/add-trycatch-logger.ts

import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SRC_ROOT = path.resolve('src/app/api');
const EXCLUDE_FILES = new Set([
  // Hello World scaffold
  path.join(SRC_ROOT, 'route.ts'),
]);

function deriveApiPath(filePath: string): string {
  const rel = path.relative(SRC_ROOT, filePath).replace(/\\/g, '/');
  const parts = rel.split('/');
  if (parts.length === 1) return '/api';
  return '/api/' + parts.slice(0, -1).join('/');
}

function hasLoggerError(block: ts.Block): boolean {
  for (const stmt of block.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const expr = stmt.expression.expression;
      if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === 'logger' &&
        expr.name.text === 'error'
      ) {
        return true;
      }
    }
  }
  return false;
}

function getLineIndent(content: string, pos: number): string {
  let lineStart = pos;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }
  let indent = '';
  while (lineStart < content.length && (content[lineStart] === ' ' || content[lineStart] === '\t')) {
    indent += content[lineStart];
    lineStart++;
  }
  return indent;
}

function findMultilineTemplateRanges(
  body: ts.Block,
  sourceFile: ts.SourceFile
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  function visit(node: ts.Node) {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const startLine = sourceFile.getLineAndCharacterOfPosition(start).line;
      const endLine = sourceFile.getLineAndCharacterOfPosition(end).line;
      if (endLine > startLine) {
        ranges.push([start, end]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return ranges;
}

function indentText(
  text: string,
  indent: string,
  mlTemplateRanges: Array<[number, number]>,
  offset: number
): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let pos = offset;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = pos;
    const lineEnd = pos + line.length;
    const inMultilineTemplate = mlTemplateRanges.some(
      ([start, end]) => lineStart < end && lineEnd > start
    );
    if (!inMultilineTemplate && line.length > 0 && /^\s*\S/.test(line)) {
      result.push(indent + line);
    } else {
      result.push(line);
    }
    pos = lineEnd + 1; // +1 for \n
  }
  return result.join('\n');
}

function hasLoggerImport(content: string): boolean {
  // matches: import { logger } from '@/lib/logger';  (with any whitespace)
  return /import\s+\{[^}]*\blogger\b[^}]*\}\s+from\s+['"]@\/lib\/logger['"]/.test(content);
}

function hasNextResponseImport(content: string): boolean {
  // matches any import that destructures NextResponse from 'next/server'
  return /import\s+\{[^}]*\bNextResponse\b[^}]*\}\s+from\s+['"]next\/server['"]/.test(content);
}

function addImportNamed(
  content: string,
  named: string,
  fromModule: string
): string {
  // If there's already an import from that module, add the named identifier to it.
  const existing = new RegExp(
    `(import\\s*\\{)([^}]*)(\\}\\s*from\\s*['"]${fromModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"])`
  );
  if (existing.test(content)) {
    // Check if already named
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
  // Otherwise add a fresh import line at the top (after existing imports)
  const sourceFile = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true);
  let lastImportEnd = 0;
  for (const s of sourceFile.statements) {
    if (ts.isImportDeclaration(s)) {
      lastImportEnd = s.getEnd();
    }
  }
  const importLine = `import { ${named} } from '${fromModule}';`;
  if (lastImportEnd > 0) {
    return content.substring(0, lastImportEnd) + '\n' + importLine + content.substring(lastImportEnd);
  }
  return importLine + '\n\n' + content;
}

function addLoggerImport(content: string): string {
  if (hasLoggerImport(content)) return content;
  return addImportNamed(content, 'logger', '@/lib/logger');
}

function ensureNextResponseImported(content: string): string {
  if (hasNextResponseImport(content)) return content;
  return addImportNamed(content, 'NextResponse', 'next/server');
}

interface Transform {
  start: number;
  end: number;
  newText: string;
}

function processFile(
  filePath: string
): { handlersWrapped: number; catchBlocksLogged: number; modified: boolean } {
  const content = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const apiPath = deriveApiPath(filePath);

  const transforms: Transform[] = [];
  let handlersWrapped = 0;
  let catchBlocksLogged = 0;
  let needsLoggerImport = false;

  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
    if (!HTTP_METHODS.includes(stmt.name.text)) continue;
    const isExported =
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!isExported) continue;

    const method = stmt.name.text;
    const body = stmt.body;
    if (!body) continue;

    const realStatements = body.statements.filter(
      (s) => s.kind !== ts.SyntaxKind.EmptyStatement
    );
    const firstIsTry =
      realStatements.length > 0 && ts.isTryStatement(realStatements[0]);
    const onlyTry = realStatements.length === 1;

    if (firstIsTry && onlyTry) {
      // Task B: check the catch block of the top-level try
      const tryStmt = realStatements[0] as ts.TryStatement;
      const catchClause = tryStmt.catchClause;
      if (catchClause && catchClause.block) {
        if (!hasLoggerError(catchClause.block)) {
          let catchVarName = 'err';
          if (catchClause.variableDeclaration) {
            const nameNode = catchClause.variableDeclaration.name;
            if (ts.isIdentifier(nameNode)) {
              catchVarName = nameNode.text;
            }
          }
          const blockNode = catchClause.block;
          const blockOpenBraceEnd = blockNode.getStart() + 1;

          let stmtIndent: string;
          if (blockNode.statements.length > 0) {
            const firstStmt = blockNode.statements[0];
            stmtIndent = getLineIndent(content, firstStmt.getStart(sourceFile));
          } else {
            const catchIndent = getLineIndent(content, catchClause.getStart(sourceFile));
            stmtIndent = catchIndent + '  ';
          }

          const loggerLine = `logger.error(${JSON.stringify(
            apiPath
          )}, ${JSON.stringify(method + ' handler failed')}, ${catchVarName});`;

          const afterBrace = content.substring(blockOpenBraceEnd, blockOpenBraceEnd + 1);
          if (afterBrace === '\n' || afterBrace === '\r') {
            // Multi-line: insert on its own line before existing content
            transforms.push({
              start: blockOpenBraceEnd,
              end: blockOpenBraceEnd,
              newText: '\n' + stmtIndent + loggerLine,
            });
          } else if (afterBrace === ' ' || afterBrace === '\t') {
            // One-line: insert after the space
            transforms.push({
              start: blockOpenBraceEnd + 1,
              end: blockOpenBraceEnd + 1,
              newText: loggerLine + ' ',
            });
          } else {
            // One-line no space: insert with surrounding spaces
            transforms.push({
              start: blockOpenBraceEnd,
              end: blockOpenBraceEnd,
              newText: ' ' + loggerLine + ' ',
            });
          }
          catchBlocksLogged++;
          needsLoggerImport = true;
        }
      }
    } else {
      // Task A: wrap the body in try/catch
      const bodyOpenBracePos = body.getStart();
      const bodyCloseBracePos = body.getEnd() - 1;
      const bodyContentStart = bodyOpenBracePos + 1;
      const bodyContentEnd = bodyCloseBracePos;
      const bodyContent = content.substring(bodyContentStart, bodyContentEnd);

      const templateRanges = findMultilineTemplateRanges(body, sourceFile);
      const bodyIndent = getLineIndent(content, bodyOpenBracePos);
      const indentedBody = indentText(bodyContent, '  ', templateRanges, bodyContentStart);

      const newBodyContent =
        `\n${bodyIndent}  try {` +
        indentedBody +
        `\n${bodyIndent}  } catch (err) {` +
        `\n${bodyIndent}    logger.error(${JSON.stringify(apiPath)}, ${JSON.stringify(
          method + ' handler failed'
        )}, err);` +
        `\n${bodyIndent}    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });` +
        `\n${bodyIndent}  }` +
        `\n`;

      transforms.push({
        start: bodyContentStart,
        end: bodyContentEnd,
        newText: newBodyContent,
      });
      handlersWrapped++;
      needsLoggerImport = true;
    }
  }

  if (transforms.length === 0 && !needsLoggerImport) {
    return { handlersWrapped: 0, catchBlocksLogged: 0, modified: false };
  }

  transforms.sort((a, b) => b.start - a.start);
  let newContent = content;
  for (const t of transforms) {
    newContent =
      newContent.substring(0, t.start) + t.newText + newContent.substring(t.end);
  }

  if (needsLoggerImport) {
    newContent = addLoggerImport(newContent);
    // Ensure NextResponse is also imported since catch blocks use NextResponse.json(...)
    newContent = ensureNextResponseImported(newContent);
  }

  fs.writeFileSync(filePath, newContent);
  return { handlersWrapped, catchBlocksLogged, modified: true };
}

function walk(dir: string, files: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, files);
    else if (e.name === 'route.ts') files.push(full);
  }
}

// Main
const files: string[] = [];
walk(SRC_ROOT, files);

let totalWrapped = 0;
let totalLogged = 0;
let modifiedFiles = 0;
const skipped: string[] = [];

for (const f of files) {
  if (EXCLUDE_FILES.has(f)) {
    skipped.push(f);
    continue;
  }
  if (f.includes('[...path]')) {
    skipped.push(f);
    continue;
  }
  if (f.includes('tests/') || f.includes('__tests__')) {
    skipped.push(f);
    continue;
  }
  const result = processFile(f);
  totalWrapped += result.handlersWrapped;
  totalLogged += result.catchBlocksLogged;
  if (result.modified) modifiedFiles++;
}

console.log('=== Transformation Summary ===');
console.log(`Total handlers wrapped (Task A): ${totalWrapped}`);
console.log(`Total catch blocks logged (Task B): ${totalLogged}`);
console.log(`Files modified: ${modifiedFiles}`);
console.log(`Files skipped: ${skipped.length}`);
if (skipped.length > 0) {
  console.log('Skipped files:');
  for (const s of skipped) console.log('  ' + s);
}
