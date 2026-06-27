import { Pool, types } from "pg";

// 让 date / timestamp 以字符串返回（如 "2026-06-21"），避免被解析成 JS Date 造成格式错乱。
types.setTypeParser(1082, (value) => value); // date
types.setTypeParser(1114, (value) => value); // timestamp
types.setTypeParser(1184, (value) => value); // timestamptz

let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // 本地/同机数据库无需 SSL；如连云数据库要求 SSL，设 PGSSL=1。
      ssl: process.env.PGSSL === "1" ? { rejectUnauthorized: false } : undefined,
      max: 5
    });
  }
  return pool;
}

export function isPgConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function ident(name: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`非法标识符：${name}`);
  }
  return `"${name}"`;
}

// jsonb（对象/对象数组）转 JSON 字符串；text[]（原始值数组）原样交给 node-postgres 处理。
function toPgValue(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

export async function pgReadTable<T>(table: string, order: string): Promise<T[]> {
  const [col, dir] = order.split(".");
  const direction = dir?.toLowerCase() === "desc" ? "DESC" : "ASC";
  const sql = `SELECT * FROM ${ident(table)} ORDER BY ${ident(col)} ${direction}`;
  const result = await getPool().query(sql);
  return result.rows as T[];
}

export async function pgClearTable(table: string) {
  await getPool().query(`DELETE FROM ${ident(table)}`);
}

export async function pgDeleteByIds(table: string, column: string, ids: string[]) {
  if (ids.length === 0) return;
  await getPool().query(`DELETE FROM ${ident(table)} WHERE ${ident(column)} = ANY($1)`, [ids]);
}

export async function pgDeleteByColumn(table: string, column: string, value: string) {
  await getPool().query(`DELETE FROM ${ident(table)} WHERE ${ident(column)} = $1`, [value]);
}

export async function pgUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
) {
  if (rows.length === 0) return;
  const conflictCols = onConflict.split(",").map((part) => part.trim());
  const cols = Object.keys(rows[0]);
  const params: unknown[] = [];
  const valuesSql = rows
    .map((row) => {
      const placeholders = cols.map((col) => {
        params.push(toPgValue(row[col]));
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    })
    .join(", ");
  const updateCols = cols.filter((col) => !conflictCols.includes(col));
  const conflictClause =
    updateCols.length > 0
      ? `ON CONFLICT (${conflictCols.map(ident).join(", ")}) DO UPDATE SET ${updateCols
          .map((col) => `${ident(col)} = EXCLUDED.${ident(col)}`)
          .join(", ")}`
      : `ON CONFLICT (${conflictCols.map(ident).join(", ")}) DO NOTHING`;
  const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(", ")}) VALUES ${valuesSql} ${conflictClause}`;
  await getPool().query(sql, params);
}
