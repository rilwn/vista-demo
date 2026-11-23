import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(root, 'apps/api/src/database/migrations');
const outputDir = path.join(root, 'output/pdf');
const workDir = path.join(os.tmpdir(), 'vista-as-built-handover');
const glossaryPath = path.join(root, 'docs/database/glossary-bg-en.json');
const dateLabel = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Europe/Sofia' }).format(new Date());
const regularFont = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const boldFont = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

for (const [label, file] of [['regular font', regularFont], ['bold font', boldFont]]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
}

function splitSqlStatements(sql) {
  const statements = [];
  let buffer = '';
  let state = 'normal';
  let dollarTag = '';
  let blockDepth = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (state === 'line-comment') {
      if (ch === '\n') { state = 'normal'; buffer += '\n'; }
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '/' && next === '*') { blockDepth += 1; i += 1; continue; }
      if (ch === '*' && next === '/') { blockDepth -= 1; i += 1; if (!blockDepth) state = 'normal'; continue; }
      continue;
    }
    if (state === 'single') {
      buffer += ch;
      if (ch === "'" && next === "'") { buffer += next; i += 1; continue; }
      if (ch === "'" && sql[i - 1] !== '\\') state = 'normal';
      continue;
    }
    if (state === 'double') {
      buffer += ch;
      if (ch === '"' && next === '"') { buffer += next; i += 1; continue; }
      if (ch === '"') state = 'normal';
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) { buffer += dollarTag; i += dollarTag.length - 1; state = 'normal'; }
      else buffer += ch;
      continue;
    }
    if (ch === '-' && next === '-') { state = 'line-comment'; i += 1; continue; }
    if (ch === '/' && next === '*') { state = 'block-comment'; blockDepth = 1; i += 1; continue; }
    if (ch === "'") { state = 'single'; buffer += ch; continue; }
    if (ch === '"') { state = 'double'; buffer += ch; continue; }
    if (ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) { state = 'dollar'; dollarTag = match[0]; buffer += dollarTag; i += dollarTag.length - 1; continue; }
    }
    if (ch === ';') { if (buffer.trim()) statements.push(buffer.trim()); buffer = ''; }
    else buffer += ch;
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

function splitTopLevel(text, delimiter = ',') {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i + 1] === quote) { i += 1; continue; }
      if (ch === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === delimiter && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function closingParen(text, openIndex) {
  let depth = 0;
  let quote = '';
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i + 1] === quote) { i += 1; continue; }
      if (ch === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')' && --depth === 0) return i;
  }
  throw new Error('Unbalanced parentheses in migration SQL');
}

function unquote(identifier) { return identifier.replaceAll('"', ''); }

function parseQualifiedName(raw, fallbackSchema = 'public') {
  const parts = raw.trim().split('.').map((part) => unquote(part.trim()));
  return parts.length === 1 ? `${fallbackSchema}.${parts[0]}` : `${parts[0]}.${parts[1]}`;
}

function parseColumnName(raw) { return unquote(raw.trim()); }

function typeAndColumn(spec) {
  const clean = spec.trim().replace(/,$/, '');
  const nameMatch = clean.match(/^((?:"[^"]+")|(?:[A-Za-z_][\w$]*))\s+([\s\S]+)$/);
  if (!nameMatch) return null;
  const name = parseColumnName(nameMatch[1]);
  const rest = nameMatch[2].trim();
  const constraintMatch = rest.match(/\b(?:NOT\s+NULL|NULL|DEFAULT|GENERATED\s+(?:ALWAYS|BY)|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|COLLATE)\b/i);
  const type = (constraintMatch ? rest.slice(0, constraintMatch.index) : rest).trim();
  const defaultMatch = rest.match(/\bDEFAULT\s+([\s\S]*?)(?=\s+(?:NOT\s+NULL|NULL|CHECK|REFERENCES|UNIQUE|PRIMARY\s+KEY|CONSTRAINT|GENERATED)\b|$)/i);
  const generated = /\bGENERATED\s+(?:ALWAYS|BY)\b/i.test(rest);
  return {
    name, type,
    nullable: !/\bNOT\s+NULL\b/i.test(rest) && !/\bPRIMARY\s+KEY\b/i.test(rest),
    default: generated ? 'generated' : (defaultMatch?.[1]?.trim() ?? ''),
    unique: /\bUNIQUE\b/i.test(rest),
    primary: /\bPRIMARY\s+KEY\b/i.test(rest),
    generated,
    checks: [...rest.matchAll(/\bCHECK\s*\(/gi)].length,
  };
}

function fieldList(raw) { return splitTopLevel(raw).map(parseColumnName); }

function parseReference(match, source, localColumns, clause) {
  const target = parseQualifiedName(match[1], source.split('.')[0]);
  const targetColumns = fieldList(match[2]);
  const deleteRule = clause.match(/\bON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]?.toUpperCase().replace(/\s+/g, ' ') ?? 'NO ACTION';
  const updateRule = clause.match(/\bON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]?.toUpperCase().replace(/\s+/g, ' ') ?? 'NO ACTION';
  return { source, localColumns, target, targetColumns, deleteRule, updateRule };
}

function referencesInClause(clause, source, localColumn = null) {
  const relations = [];
  const compound = clause.match(/\bFOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(([^)]+)\)/i);
  if (compound) {
    const tail = clause.slice(compound.index + compound[0].length);
    relations.push(parseReference([compound[0], compound[2], compound[3]], source, fieldList(compound[1]), tail));
  } else {
    const inline = clause.match(/\bREFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(([^)]+)\)/i);
    if (inline && localColumn) {
      const tail = clause.slice(inline.index + inline[0].length);
      relations.push(parseReference([inline[0], inline[1], inline[2]], source, [localColumn], tail));
    }
  }
  return relations;
}

function addConstraint(table, clause) {
  const primary = clause.match(/\bPRIMARY\s+KEY\s*\(([^)]+)\)/i);
  if (primary) for (const name of fieldList(primary[1])) if (table.columns.has(name)) table.columns.get(name).primary = true;
  const unique = clause.match(/\bUNIQUE\s*\(([^)]+)\)/i);
  if (unique) {
    const columns = fieldList(unique[1]);
    table.uniqueIndexes.push({ name: clause.match(/\bCONSTRAINT\s+([^\s]+)/i)?.[1] ?? '(unique constraint)', expressions: columns, where: '', migration: table.migration });
    if (columns.length === 1 && table.columns.has(columns[0])) table.columns.get(columns[0]).unique = true;
  }
  if (/\bCHECK\s*\(/i.test(clause)) table.checkCount += 1;
  table.relations.push(...referencesInClause(clause, table.name));
}

function parseCreateTable(statement, migration, tables) {
  const match = statement.match(/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(/i);
  if (!match) return;
  const name = parseQualifiedName(match[1]);
  const open = statement.indexOf('(', match.index + match[0].length - 1);
  const close = closingParen(statement, open);
  const table = { name, migration, columns: new Map(), relations: [], checkCount: 0, uniqueIndexes: [] };
  for (const part of splitTopLevel(statement.slice(open + 1, close))) {
    if (/^(?:CONSTRAINT\s+\S+\s+)?(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/i.test(part)) {
      addConstraint(table, part);
      continue;
    }
    const column = typeAndColumn(part);
    if (!column) continue;
    table.columns.set(column.name, column);
    if (column.primary) column.nullable = false;
    if (column.checks) table.checkCount += column.checks;
    table.relations.push(...referencesInClause(part, name, column.name));
  }
  if (tables.has(name)) throw new Error(`Table created more than once: ${name}`);
  tables.set(name, table);
}

function parseUniqueIndex(statement, migration, tables) {
  const match = statement.match(/^CREATE\s+UNIQUE\s+INDEX(?:\s+CONCURRENTLY)?\s+(?:(?:IF\s+NOT\s+EXISTS)\s+)?((?:"[^"]+")|(?:[A-Za-z_][\w$]*))\s+ON\s+(?:ONLY\s+)?((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*(?:USING\s+[A-Za-z_][\w$]*\s*)?\(([^)]*(?:\([^)]*\)[^)]*)*)\)([\s\S]*)$/i);
  if (!match) return;
  let tableName = parseQualifiedName(match[2]);
  if (!tables.has(tableName) && !match[2].includes('.')) {
    const candidates = [...tables.keys()].filter((name) => name.endsWith(`.${parseQualifiedName(match[2]).split('.')[1]}`));
    if (candidates.length === 1) tableName = candidates[0];
  }
  const table = tables.get(tableName);
  if (!table) return;
  const expressions = splitTopLevel(match[3]).map(safeText);
  const where = match[4].match(/\bWHERE\s+([\s\S]+)$/i)?.[1]?.trim() ?? '';
  table.uniqueIndexes.push({ name: unquote(match[1]), expressions, where, migration });
  for (const expression of expressions) {
    const identifier = expression.match(/^(?:"([^"]+)"|([A-Za-z_][\w$]*))$/);
    const column = identifier?.[1] ?? identifier?.[2];
    if (expressions.length === 1 && !where && column && table.columns.has(column)) table.columns.get(column).unique = true;
  }
}

function alterTable(statement, migration, tables) {
  const match = statement.match(/^ALTER\s+TABLE\s+(?:ONLY\s+)?((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s+([\s\S]+)$/i);
  if (!match) return;
  const name = parseQualifiedName(match[1]);
  const table = tables.get(name);
  if (!table) return;
  for (const action of splitTopLevel(match[2])) {
    const addColumn = action.match(/^ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([\s\S]+)$/i);
    if (addColumn) {
      const col = typeAndColumn(addColumn[1]);
      if (col) {
        table.columns.set(col.name, table.columns.get(col.name) ?? col);
        if (col.checks) table.checkCount += col.checks;
        table.relations.push(...referencesInClause(addColumn[1], name, col.name));
      }
      continue;
    }
    if (/^ADD\s+(?:CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY|UNIQUE|CHECK)\b/i.test(action)) {
      addConstraint(table, action.replace(/^ADD\s+/i, ''));
      continue;
    }
    const alterColumn = action.match(/^ALTER\s+COLUMN\s+((?:"[^"]+")|(?:[A-Za-z_][\w$]*))\s+([\s\S]+)$/i);
    if (alterColumn) {
      const column = table.columns.get(parseColumnName(alterColumn[1]));
      if (!column) continue;
      const change = alterColumn[2];
      if (/^SET\s+NOT\s+NULL\b/i.test(change)) column.nullable = false;
      if (/^DROP\s+NOT\s+NULL\b/i.test(change)) column.nullable = true;
      if (/^DROP\s+DEFAULT\b/i.test(change)) column.default = '';
      const setDefault = change.match(/^SET\s+DEFAULT\s+([\s\S]+)$/i);
      if (setDefault) column.default = setDefault[1].trim();
    }
  }
}

function applyEurColumnRename(tables) {
  const renamed = new Map();
  for (const table of tables.values()) {
    if (!['finance', 'inventory', 'procurement', 'service', 'crm', 'pos', 'sales'].includes(table.name.split('.')[0])) continue;
    const map = new Map();
    for (const [oldName, column] of [...table.columns]) {
      let newName = oldName;
      if (oldName === 'earn_points_per_bgn') newName = 'earn_points_per_eur';
      else if (oldName.startsWith('bgn_')) newName = `eur_${oldName.slice(4)}`;
      else if (oldName.endsWith('_bgn')) newName = `${oldName.slice(0, -4)}_eur`;
      if (newName !== oldName) { map.set(oldName, newName); table.columns.delete(oldName); column.name = newName; table.columns.set(newName, column); }
    }
    if (map.size) renamed.set(table.name, map);
  }
  for (const table of tables.values()) {
    const own = renamed.get(table.name);
    for (const relation of table.relations) {
      if (own) relation.localColumns = relation.localColumns.map((column) => own.get(column) ?? column);
      const targetMap = renamed.get(relation.target);
      if (targetMap) relation.targetColumns = relation.targetColumns.map((column) => targetMap.get(column) ?? column);
    }
  }
}

function parseSchema() {
  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.up.sql')).sort();
  const tables = new Map();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const statement of splitSqlStatements(sql)) {
      if (/^CREATE\s+TABLE\b/i.test(statement)) parseCreateTable(statement, file, tables);
      else if (/^CREATE\s+UNIQUE\s+INDEX\b/i.test(statement)) parseUniqueIndex(statement, file, tables);
      else if (/^ALTER\s+TABLE\b/i.test(statement)) alterTable(statement, file, tables);
    }
    if (file === '0069_eur_transition.up.sql') applyEurColumnRename(tables);
  }
  for (const table of tables.values()) {
    const seen = new Set();
    table.relations = table.relations.filter((relation) => {
      const key = `${relation.localColumns.join(',')}->${relation.target}(${relation.targetColumns.join(',')})`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (tables.size !== 221) throw new Error(`Expected 221 distinct forward-migration tables, parsed ${tables.size}`);
  return { files, tables };
}

function safeText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

function drawHeader(doc, kind) {
  const cursor = { x: doc.x, y: doc.y };
  doc.save();
  doc.fillColor('#173c2c').font('VistaBold').fontSize(8).text('VISTA SERVICE  /  DATABASE HANDOVER', 38, 20, { lineBreak: false });
  doc.fillColor('#66756c').font('Vista').fontSize(8).text(kind, doc.page.width - 225, 20, { width: 187, align: 'right', lineBreak: false });
  doc.restore();
  doc.x = cursor.x;
  doc.y = cursor.y;
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.save();
    doc.strokeColor('#d6dfd7').lineWidth(0.5).moveTo(38, doc.page.height - 43).lineTo(doc.page.width - 38, doc.page.height - 43).stroke();
    doc.fillColor('#69776e').font('Vista').fontSize(7.5).text(`Vista Service  |  ${dateLabel}`, 38, doc.page.height - 35, { lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, doc.page.width - 105, doc.page.height - 35, { width: 67, align: 'right', lineBreak: false });
    doc.restore();
  }
}

function newPdf(filename, kind) {
  const output = path.join(workDir, filename);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 48, bottom: 18, left: 38, right: 38 }, bufferPages: true, autoFirstPage: true });
  doc.registerFont('Vista', regularFont).registerFont('VistaBold', boldFont);
  doc.on('pageAdded', () => drawHeader(doc, kind));
  drawHeader(doc, kind);
  return { doc, output };
}

function ensureSpace(doc, height) {
  if (doc.y + height > doc.page.height - 45) doc.addPage();
}

function drawTable(doc, headers, rows, widths, { fontSize = 8, headerSize = 8, rowPad = 5, repeatHeader = true, continuationLabel = '' } = {}) {
  const drawHeaderRow = () => {
    doc.x = 38;
    const top = doc.y;
    const h = 24;
    let x = 38;
    headers.forEach((header, i) => {
      doc.save().fillColor('#173c2c').rect(x, top, widths[i], h).fill();
      doc.fillColor('#ffffff').font('VistaBold').fontSize(headerSize).text(header, x + 5, top + 6, { width: widths[i] - 10, height: h - 8, ellipsis: true });
      doc.restore();
      x += widths[i];
    });
    doc.y = top + h;
    doc.x = 38;
  };
  drawHeaderRow();
  for (const row of rows) {
    const heights = row.map((value, i) => doc.font('Vista').fontSize(fontSize).heightOfString(safeText(value) || '-', { width: widths[i] - 10, lineGap: 1 }));
    const height = Math.max(20, ...heights) + rowPad * 2;
    if (doc.y + height > doc.page.height - 45) {
      doc.addPage();
      if (continuationLabel) {
        doc.fillColor('#617066').font('VistaBold').fontSize(7.5).text(`${continuationLabel} (continued)`, 38, doc.y, { width: doc.page.width - 76, lineBreak: false });
        doc.moveDown(0.45);
      }
      if (repeatHeader) drawHeaderRow();
    }
    const top = doc.y;
    let x = 38;
    row.forEach((value, i) => {
      doc.save();
      doc.fillColor('#ffffff').rect(x, top, widths[i], height).fillAndStroke('#ffffff', '#d7dfd8');
      doc.fillColor('#25352c').font('Vista').fontSize(fontSize).text(safeText(value) || '-', x + 5, top + rowPad, { width: widths[i] - 10, height: height - rowPad * 2, lineGap: 1, ellipsis: true });
      doc.restore();
      x += widths[i];
    });
    doc.y = top + height;
    doc.x = 38;
  }
  doc.moveDown(0.45);
  doc.x = 38;
}

function startCover(doc, title, subtitle, metrics) {
  doc.x = 38;
  doc.moveDown(3);
  doc.fillColor('#2c6849').font('VistaBold').fontSize(12).text('VISTA SERVICE LTD.', 38, doc.y, { width: doc.page.width - 76, align: 'center' });
  doc.moveDown(0.8);
  doc.fillColor('#142d20').font('VistaBold').fontSize(27).text(title, 38, doc.y, { width: doc.page.width - 76, align: 'center' });
  doc.moveDown(0.5);
  doc.fillColor('#586a5e').font('Vista').fontSize(13).text(subtitle, 38, doc.y, { width: doc.page.width - 76, align: 'center' });
  doc.moveDown(1.5);
  doc.fillColor('#41574a').font('Vista').fontSize(10).text(`As-built source: PostgreSQL forward migrations 0001 to 0121  |  Prepared ${dateLabel}`, 38, doc.y, { width: doc.page.width - 76, align: 'center' });
  doc.moveDown(1.4);
  metrics.forEach(([value, label]) => {
    doc.fillColor('#173c2c').font('VistaBold').fontSize(19).text(value, 38, doc.y, { width: doc.page.width - 76, align: 'center' });
    doc.fillColor('#64736a').font('Vista').fontSize(9).text(label, 38, doc.y, { width: doc.page.width - 76, align: 'center' });
    doc.moveDown(0.45);
  });
  doc.moveDown(0.9);
  doc.fillColor('#34453b').font('Vista').fontSize(9).text('This reference is generated from the repository migration history, not a live production database. Table presence documents the data model; it does not by itself certify feature completion or client acceptance.', 110, doc.y, { align: 'center', width: doc.page.width - 220, lineGap: 3 });
  doc.addPage();
}

function moduleName(schema) {
  const names = {
    audit: 'Audit', backup: 'Backup and recovery', crm: 'CRM', files: 'Shared files', finance: 'Finance',
    iam: 'Roles and permissions', identity: 'Identity and access', integration: 'Integrations', inventory: 'Inventory',
    logistics: 'Logistics', master_data: 'Master data', notifications: 'Notifications', organization: 'Business structure',
    platform: 'Platform', pos: 'Point of sale', procurement: 'Procurement', reporting: 'Reports', sales: 'Sales', service: 'Service',
  };
  return names[schema] ?? schema;
}

function buildDot(schema, tables, relations) {
  const schemaTables = [...tables.values()].filter((table) => table.name.startsWith(`${schema}.`)).sort((a, b) => a.name.localeCompare(b.name));
  const names = new Set(schemaTables.map((table) => table.name));
  const localRelations = relations.filter((relation) => names.has(relation.source) && names.has(relation.target));
  const lines = [
    'digraph Vista {',
    'graph [rankdir=LR, bgcolor="white", pad="0.25", nodesep="0.28", ranksep="0.65", splines=polyline, overlap=false, fontname="DejaVu Sans", fontsize=18, labelloc=t, labeljust=l, label="' + `${moduleName(schema)} (${schema})  -  ${schemaTables.length} tables, ${localRelations.length} internal foreign keys` + '"];',
    'node [shape=box, style="rounded,filled", fillcolor="#f3f7f3", color="#9eb6a3", penwidth=1, fontname="DejaVu Sans", fontsize=9, margin="0.12,0.08"];',
    'edge [color="#567e62", fontcolor="#45594b", fontname="DejaVu Sans", fontsize=7, arrowsize=0.7];',
  ];
  for (const table of schemaTables) lines.push(`"${table.name}" [label="${table.name}"];`);
  for (const relation of localRelations) {
    const label = `${relation.localColumns.join(', ')}  [${relation.deleteRule}]`;
    lines.push(`"${relation.source}" -> "${relation.target}" [label="${label.replaceAll('"', '\\"')}"];`);
  }
  lines.push('}');
  return { dot: lines.join('\n'), schemaTables, localRelations };
}

async function writePdf(doc, output) {
  drawFooters(doc);
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(output);
    stream.on('finish', resolve).on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    doc.end();
  });
}

async function makeErd(tables, relations) {
  const { doc, output } = newPdf('vista-erd-index.pdf', 'ERD / ERD');
  startCover(doc, 'Database Entity Relationship Diagrams', 'Диаграми на обектите и връзките в актуалния модел', [
    [String(tables.size), 'distinct tables / таблици'],
    [String(relations.length), 'foreign-key relationships / връзки с външен ключ'],
    [String(new Set([...tables.keys()].map((name) => name.split('.')[0])).size), 'PostgreSQL schemas / схеми'],
  ]);
  doc.x = 38;
  doc.fillColor('#173c2c').font('VistaBold').fontSize(18).text('Schema index / Индекс по схеми');
  doc.x = 38;
  doc.moveDown(0.35);
  doc.fillColor('#53645a').font('Vista').fontSize(9).text('The detailed pages show table-level foreign-key links within each schema. Cross-schema links are summarized below and fully listed in the companion dictionary.');
  doc.moveDown(0.7);
  const schemas = [...new Set([...tables.keys()].map((name) => name.split('.')[0]))].sort();
  const counts = schemas.map((schema) => [schema, moduleName(schema), String([...tables.keys()].filter((name) => name.startsWith(`${schema}.`)).length)]);
  const pageWidth = doc.page.width - 76;
  drawTable(doc, ['Schema', 'Area / Област', 'Tables / Таблици'], counts, [pageWidth * 0.24, pageWidth * 0.53, pageWidth * 0.23]);
  doc.addPage();
  doc.x = 38;
  doc.fillColor('#173c2c').font('VistaBold').fontSize(18).text('Cross-schema relationships / Междусхемни връзки');
  doc.x = 38;
  doc.moveDown(0.35);
  doc.fillColor('#53645a').font('Vista').fontSize(9).text('Direction: referenced (parent) schema to referencing (child) schema. Each count is a declared foreign-key constraint in the forward migrations.');
  doc.moveDown(0.7);
  const pairs = new Map();
  for (const relation of relations) {
    const parent = relation.target.split('.')[0];
    const child = relation.source.split('.')[0];
    if (parent === child) continue;
    const key = `${parent}\0${child}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const rows = [...pairs.entries()].map(([key, count]) => [key.split('\0')[0], key.split('\0')[1], String(count)]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  drawTable(doc, ['Parent schema', 'Child schema', 'FK count'], rows, [pageWidth * 0.36, pageWidth * 0.36, pageWidth * 0.28]);
  await writePdf(doc, output);

  const schemaPdfs = [];
  for (const schema of schemas) {
    const built = buildDot(schema, tables, relations);
    const dotPath = path.join(workDir, `${schema}.dot`);
    const pdfPath = path.join(workDir, `${schema}.pdf`);
    fs.writeFileSync(dotPath, built.dot);
    run('dot', ['-Tpdf', dotPath, '-o', pdfPath]);
    schemaPdfs.push(pdfPath);
  }
  const finalPath = path.join(outputDir, 'Vista_AsBuilt_ERD.pdf');
  run('pdfunite', [output, ...schemaPdfs, finalPath]);
  return finalPath;
}

function tableColumnRows(table) {
  return [...table.columns.values()].map((column) => [
    column.name,
    column.type || '(type not parsed)',
    [column.primary ? 'PK' : '', column.unique ? 'UNIQUE' : '', table.relations.some((relation) => relation.localColumns.includes(column.name)) ? 'FK' : ''].filter(Boolean).join(', ') || '-',
    column.nullable ? 'Yes' : 'No',
    column.default || (column.generated ? 'generated' : '-'),
  ]);
}

function tableRelationRows(table) {
  return table.relations.map((relation) => [relation.localColumns.join(', '), relation.target, relation.targetColumns.join(', '), relation.deleteRule, relation.updateRule]);
}

async function makeDictionary(tables, relations, files) {
  const { doc, output } = newPdf('vista-dictionary-working.pdf', 'Data dictionary / Речник на данните');
  const schemas = [...new Set([...tables.keys()].map((name) => name.split('.')[0]))].sort();
  const glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
  startCover(doc, 'Data Dictionary and Business Glossary', 'Речник на данните и термините', [
    [String(tables.size), 'tables / таблици'],
    [String([...tables.values()].reduce((sum, table) => sum + table.columns.size, 0)), 'declared columns / декларирани колони'],
    [String(glossary.length), 'business terms / бизнес термини'],
  ]);
  doc.x = 38;
  doc.fillColor('#173c2c').font('VistaBold').fontSize(18).text('How to use this reference / Как да използвате документа');
  doc.x = 38;
  doc.moveDown(0.4);
  doc.fillColor('#34453b').font('Vista').fontSize(9).text('This dictionary is generated from the ordered PostgreSQL forward migrations in the repository. It includes table columns, declared data types, nullability, primary/unique/foreign-key markers, defaults and generated-column markers, plus declared foreign-key targets and actions. The deployed database was not queried; compare its applied migration number before treating it as deployment evidence.');
  doc.moveDown(0.45);
  doc.text('Речникът е генериран от подредените PostgreSQL миграции в хранилището. Включва колони, типове, задължителност, PK/UNIQUE/FK, стойности по подразбиране, генерирани колони и връзки с правилата им. Не е направена заявка към работната база; проверете приложената миграция преди да го използвате като доказателство за внедрена версия.', { lineGap: 3 });
  doc.moveDown(0.6);
  doc.fillColor('#173c2c').font('VistaBold').fontSize(17).text('Business glossary / Бизнес речник');
  doc.x = 38;
  doc.moveDown(0.4);
  drawTable(doc, ['Български термин', 'English term', 'Определение (BG)', 'Definition (EN)'], glossary.map((item) => [item.bg, item.en, item.bgDef, item.enDef]), [112, 112, 275, 275], { fontSize: 7.7, headerSize: 7.7, rowPad: 5 });
  doc.addPage();
  doc.x = 38;
  doc.fillColor('#173c2c').font('VistaBold').fontSize(18).text('Technical schema reference / Техническа схема');
  doc.x = 38;
  doc.moveDown(0.35);
  doc.fillColor('#53645a').font('Vista').fontSize(9).text(`Source migrations: ${files[0].slice(0, 4)} through ${files.at(-1).slice(0, 4)} (${files.length} files). Columns are shown in final migration order; the EUR transition renaming rule in migration 0069 is applied to the catalog.`);
  doc.moveDown(0.7);
  for (const schema of schemas) {
    ensureSpace(doc, 70);
    doc.x = 38;
    doc.fillColor('#173c2c').font('VistaBold').fontSize(15).text(`${schema}  /  ${moduleName(schema)}`);
    doc.moveDown(0.5);
    const schemaTables = [...tables.values()].filter((table) => table.name.startsWith(`${schema}.`)).sort((a, b) => a.name.localeCompare(b.name));
    for (const table of schemaTables) {
      ensureSpace(doc, 112);
      doc.x = 38;
      doc.fillColor('#244c36').font('VistaBold').fontSize(10.5).text(table.name);
      doc.fillColor('#617066').font('Vista').fontSize(7.5).text(`Created in ${table.migration}; ${table.columns.size} columns; ${table.relations.length} foreign-key relationships; ${table.checkCount} declared CHECK constraints.`);
      doc.moveDown(0.25);
      const width = doc.page.width - 76;
      drawTable(doc, ['Column', 'PostgreSQL type', 'Key', 'Nullable', 'Default / generated'], tableColumnRows(table), [width * 0.19, width * 0.20, width * 0.13, width * 0.11, width * 0.37], { fontSize: 7.4, headerSize: 7.4, rowPad: 3.5, continuationLabel: `${table.name} · Columns` });
      const fkRows = tableRelationRows(table);
      if (fkRows.length) {
        ensureSpace(doc, 80);
        doc.fillColor('#40574a').font('VistaBold').fontSize(8).text('Foreign keys / Външни ключове');
        doc.moveDown(0.25);
        drawTable(doc, ['Local columns', 'Referenced table', 'Target columns', 'ON DELETE', 'ON UPDATE'], fkRows, [width * 0.20, width * 0.28, width * 0.19, width * 0.17, width * 0.16], { fontSize: 7.2, headerSize: 7.2, rowPad: 3, continuationLabel: `${table.name} · Foreign keys` });
      }
      if (table.uniqueIndexes.length) {
        ensureSpace(doc, 80);
        doc.x = 38;
        doc.fillColor('#40574a').font('VistaBold').fontSize(8).text('Unique indexes and constraints / Уникални индекси и ограничения');
        doc.moveDown(0.25);
        const uniqueRows = table.uniqueIndexes.map((index) => [index.name, index.expressions.join(', '), index.where || '-', index.migration]);
        drawTable(doc, ['Name', 'Key expressions', 'Predicate', 'Migration'], uniqueRows, [width * 0.25, width * 0.30, width * 0.25, width * 0.20], { fontSize: 7.2, headerSize: 7.2, rowPad: 3, continuationLabel: `${table.name} · Unique indexes and constraints` });
      }
      doc.moveDown(0.25);
    }
  }
  await writePdf(doc, output);
  const finalPath = path.join(outputDir, 'Vista_AsBuilt_Data_Dictionary_and_Glossary.pdf');
  fs.copyFileSync(output, finalPath);
  fs.unlinkSync(output);
  return finalPath;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  const { files, tables } = parseSchema();
  const relations = [...tables.values()].flatMap((table) => table.relations);
  const unknownTargets = relations.filter((relation) => !tables.has(relation.target));
  if (unknownTargets.length) throw new Error(`Unresolved FK targets: ${unknownTargets.slice(0, 10).map((relation) => `${relation.source} -> ${relation.target}`).join('; ')}`);
  const erdPath = await makeErd(tables, relations);
  const dictionaryPath = await makeDictionary(tables, relations, files);
  console.log(JSON.stringify({ migrations: files.length, tables: tables.size, columns: [...tables.values()].reduce((sum, table) => sum + table.columns.size, 0), relationships: relations.length, uniqueIndexesAndConstraints: [...tables.values()].reduce((sum, table) => sum + table.uniqueIndexes.length, 0), schemas: new Set([...tables.keys()].map((name) => name.split('.')[0])).size, glossaryTerms: JSON.parse(fs.readFileSync(glossaryPath, 'utf8')).length, erd: erdPath, dictionary: dictionaryPath }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
