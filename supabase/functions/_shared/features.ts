export interface WorkshopFeatures {
  zones: boolean
  commercial: boolean
}

export function parseFeatures(raw: unknown): WorkshopFeatures {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    zones: value.zones === true,
    commercial: value.commercial === true,
  }
}

// deno-lint-ignore no-explicit-any
export async function fetchWorkshopFeatures(supabase: any, workshopId: string): Promise<WorkshopFeatures> {
  const { data, error } = await supabase
    .from('workshops')
    .select('features')
    .eq('id', workshopId)
    .maybeSingle()

  if (error) {
    console.error('Failed to read workshop features:', error)
    return parseFeatures(null)
  }
  return parseFeatures(data?.features)
}
