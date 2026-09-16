export interface WorkshopZone {
  key: string
  label: string
  notification_email: string | null
  aliases: string[]
}

function stripAccents(value: string): string {
  return (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// deno-lint-ignore no-explicit-any
export async function fetchWorkshopZones(supabase: any, workshopId: string): Promise<WorkshopZone[]> {
  const { data, error } = await supabase
    .from('workshop_zones')
    .select('key, label, notification_email, aliases')
    .eq('workshop_id', workshopId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Failed to read workshop zones:', error)
    return []
  }
  return (data ?? []) as WorkshopZone[]
}

export function zoneKeys(zones: WorkshopZone[]): string[] {
  return zones.map((zone) => zone.key)
}

export function zoneEmail(zones: WorkshopZone[], key: string): string | null {
  return zones.find((zone) => zone.key === key)?.notification_email ?? null
}

// Matches the customer's text against each zone's aliases, in the order the
// zones are configured, so the first configured zone wins like the old regexes.
export function detectZoneFromText(zones: WorkshopZone[], text: string): string | null {
  const plain = stripAccents((text || '').toLowerCase())
  for (const zone of zones) {
    const aliases = (zone.aliases ?? []).filter((alias) => alias.trim().length > 0)
    if (aliases.length === 0) continue
    const pattern = aliases
      .map((alias) => stripAccents(alias.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    // Lookarounds instead of \b: an alias may start or end with punctuation
    // ("san felipe (v region)"), where \b never matches.
    if (new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'u').test(plain)) return zone.key
  }
  return null
}

export function buildZonePromptSection(zones: WorkshopZone[]): string {
  if (zones.length === 0) {
    return 'No aplica para este negocio, siempre devolver zone = null'
  }
  const lines = zones.map((zone) => {
    const examples = (zone.aliases ?? []).slice(0, 6).join(', ')
    return `   - Si menciona ${examples || zone.label} → zone = "${zone.key}"`
  })
  return [
    `Detecta la zona del cliente. Las zonas válidas son: ${zoneKeys(zones).join(', ')}`,
    ...lines,
    '   - Si no menciona ubicación → zone = null',
  ].join('\n')
}
