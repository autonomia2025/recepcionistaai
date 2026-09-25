// Line description for a catalog model. Same text as the database function
// public.catalog_line_description (migration f2_t2_quote_draft), so a line added
// by hand in the editor reads exactly like one from the automatic draft.

export interface CatalogDescriptionRow {
  water_type: string | null;
  motor_type: string | null;
  pressure_bar: string | null;
  flow_lmin: string | null;
  temp_max: string | null;
}

const clean = (value: string | null | undefined) => (value ?? '').trim();

export function catalogLineDescription(row: CatalogDescriptionRow): string {
  const water = clean(row.water_type).toLowerCase();
  const motor = clean(row.motor_type).toLowerCase().replace(/(\d+)\s*v\b/g, '$1V');
  const temp = clean(row.temp_max);
  return [
    `Hidrolavadora${water ? ` ${water}` : ''}`,
    motor || null,
    clean(row.pressure_bar) ? `${clean(row.pressure_bar)} bar` : null,
    clean(row.flow_lmin) ? `${clean(row.flow_lmin)} L/min` : null,
    temp && temp !== '—' ? `temp. máx. ${temp}°C` : null,
  ].filter(Boolean).join(' · ');
}
