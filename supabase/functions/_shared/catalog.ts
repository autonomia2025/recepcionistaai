// Deterministic product catalog: the ONLY source of truth for prices.
// Prices must never be recovered by semantic similarity — a wrong chunk means a
// wrong price for the customer. Every figure comes from public.product_catalog,
// queried directly by SKU (or by selection block).

import { normalizeProductCode } from "./datasheets.ts";

export interface CatalogRow {
  sku: string;
  sku_normalized: string;
  water_type: string | null;
  motor_type: string | null;
  pressure_bar: string | null;
  flow_lmin: string | null;
  temp_max: string | null;
  price_min: number | null;
  price_max: number | null;
  datasheet_file: string | null;
}

const CATALOG_COLUMNS =
  'sku, sku_normalized, water_type, motor_type, pressure_bar, flow_lmin, temp_max, price_min, price_max, datasheet_file';

const clp = (value: number) => `$${Number(value).toLocaleString('es-CL')}`;

export function formatCatalogPrice(row: CatalogRow): string {
  if (row.price_min && row.price_max && row.price_min !== row.price_max) {
    return `rango referencial ${clp(row.price_min)} a ${clp(row.price_max)} neto`;
  }
  const single = row.price_min || row.price_max;
  return single ? `valor referencial aprox. ${clp(single)} neto` : 'sin precio documentado';
}

export function formatCatalogLine(row: CatalogRow): string {
  const specs = [
    row.pressure_bar ? `${row.pressure_bar} bar` : null,
    row.flow_lmin ? `${row.flow_lmin} L/min` : null,
    row.temp_max && row.temp_max !== '—' ? `temp máx ${row.temp_max}°C` : null,
  ].filter(Boolean).join(' | ');
  return `${row.sku} → ${formatCatalogPrice(row)}${specs ? ` (${specs})` : ''}${row.datasheet_file ? ` | ficha ${row.datasheet_file}` : ''}`;
}

// deno-lint-ignore no-explicit-any
export async function fetchCatalogBySkus(
  supabase: any,
  workshopId: string,
  codes: string[],
): Promise<CatalogRow[]> {
  const normalized = [...new Set(codes.map(normalizeProductCode).filter(c => c.length >= 4))];
  if (normalized.length === 0) return [];

  const { data, error } = await supabase
    .from('product_catalog')
    .select(CATALOG_COLUMNS)
    .eq('workshop_id', workshopId)
    .in('sku_normalized', normalized);

  if (error) {
    console.error('Catalog lookup by SKU failed:', error);
    return [];
  }
  return (data || []) as CatalogRow[];
}

const WATER_MAP: Record<string, string> = {
  'agua caliente': 'AGUA CALIENTE',
  'agua fría': 'AGUA FRÍA',
  'agua fria': 'AGUA FRÍA',
};

const MOTOR_MAP: Record<string, string> = {
  'motor diésel': 'DIÉSEL',
  'motor diesel': 'DIÉSEL',
  'motor a bencina': 'BENCINA',
  'eléctrica 380V trifásica': 'ELÉCTRICA 380V',
  'eléctrica 220V monofásica': 'ELÉCTRICA 220V',
};

export function mapWaterType(agua: string | null): string | null {
  return agua ? (WATER_MAP[agua.toLowerCase()] ?? null) : null;
}

export function mapMotorType(motor: string | null): string | null {
  return motor ? (MOTOR_MAP[motor] ?? MOTOR_MAP[motor.toLowerCase()] ?? null) : null;
}

// Section index (layer B): the whole selection block is served from the table,
// so a chunk cut can never truncate the list of valid models.
// deno-lint-ignore no-explicit-any
export async function fetchCatalogBlock(
  supabase: any,
  workshopId: string,
  waterType: string | null,
  motorType: string | null,
): Promise<CatalogRow[]> {
  if (!waterType && !motorType) return [];

  let query = supabase
    .from('product_catalog')
    .select(CATALOG_COLUMNS)
    .eq('workshop_id', workshopId)
    .order('price_min', { ascending: true });

  if (waterType) query = query.eq('water_type', waterType);
  if (motorType) query = query.eq('motor_type', motorType);

  const { data, error } = await query;
  if (error) {
    console.error('Catalog block lookup failed:', error);
    return [];
  }
  return (data || []) as CatalogRow[];
}

// deno-lint-ignore no-explicit-any
export async function fetchCatalogSkuSet(supabase: any, workshopId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('product_catalog')
    .select('sku_normalized')
    .eq('workshop_id', workshopId)
    .limit(5000);

  if (error) {
    console.error('Catalog SKU set lookup failed:', error);
    return new Set();
  }
  return new Set(((data || []) as Array<{ sku_normalized: string }>).map(r => r.sku_normalized));
}

// Codes as they are written in a reply: at least two letters followed by digits
// (SOC250/15ACD-C2, PWGB200-15T, TX1318000, MH120-10M...). Plain measurements
// ("250 bar", "15 L/min") never match.
const REPLY_CODE_RE = /\b[A-Z]{2,7}\d{2,4}(?:[/\-.][A-Z0-9]{1,10}){0,3}[A-Z0-9]*\b/g;

// Spanish words that would otherwise look like a prefix ("ELECTRICA 380V").
const CODE_PREFIX_STOPLIST = new Set([
  'ELECTRICA', 'ELECTRICO', 'TRIFASICA', 'MONOFASICA', 'AGUA', 'CALIENTE', 'FRIA',
  'BAR', 'PSI', 'HP', 'KW', 'RPM', 'IVA', 'CLP', 'PDF', 'MODELO', 'FICHA', 'RUTA',
]);

export function extractQuotedCodes(text: string): string[] {
  const plain = (text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const found = plain.match(REPLY_CODE_RE) || [];
  const out: string[] = [];
  for (const raw of found) {
    const prefix = raw.match(/^[A-Z]+/)?.[0] || '';
    if (CODE_PREFIX_STOPLIST.has(prefix)) continue;
    const normalized = normalizeProductCode(raw);
    if (normalized.length < 6) continue;
    if (!out.includes(raw.trim())) out.push(raw.trim());
  }
  return out;
}

// Layer C: any code the model writes must exist in the catalog.
export function findInventedCodes(text: string, knownSkus: Set<string>): string[] {
  if (knownSkus.size === 0) return [];
  return extractQuotedCodes(text).filter(code => !knownSkus.has(normalizeProductCode(code)));
}
