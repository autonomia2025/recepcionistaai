// "Antes de llamar" guide for a request (commercial module). The model drafts
// it; this module keeps only what the conversation backs up: every known fact
// and the customer profile must quote the customer's own words, and an answer
// can only cite a sales-playbook document that exists.

export const PROFILE_LABELS = [
  'técnico',
  'apurado',
  'sensible al precio',
  'indeciso',
  'decidido a comprar',
  'explorando opciones',
] as const

export interface CallGuide {
  opening: string | null
  known: Array<{ fact: string; evidence: string }>
  missing: string[]
  profile: { label: string; evidence: string } | null
  objections: Array<{ objection: string; answer: string; source: string | null }>
}

function normalizeText(value: string): string {
  return (value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const clip = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

// Quote must appear in what the customer wrote and carry at least two words.
export function isBackedByCustomer(evidence: string, customerMessages: string[]): boolean {
  const normalized = normalizeText(evidence.replace(/^["“”']+|["“”']+$/g, ''))
  if (normalized.split(' ').filter(Boolean).length < 2) return false
  return customerMessages.some((message) => ` ${normalizeText(message)} `.includes(` ${normalized} `))
}

export function sanitizeCallGuide(raw: unknown, customerMessages: string[], playbookTitles: string[]): CallGuide {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const titles = new Map(playbookTitles.map((title) => [normalizeText(title), title]))

  const known: CallGuide['known'] = []
  for (const item of Array.isArray(data.known) ? data.known : []) {
    const fact = clip((item as Record<string, unknown>)?.fact, 160)
    const evidence = clip((item as Record<string, unknown>)?.evidence, 200).replace(/^["“”']+|["“”']+$/g, '')
    if (fact && evidence && isBackedByCustomer(evidence, customerMessages)) known.push({ fact, evidence })
    if (known.length === 6) break
  }

  const missing = [...new Set((Array.isArray(data.missing) ? data.missing : []).map((m) => clip(m, 120)).filter(Boolean))].slice(0, 5)

  let profile: CallGuide['profile'] = null
  const rawProfile = data.profile as Record<string, unknown> | null | undefined
  const label = clip(rawProfile?.label, 40).toLowerCase()
  const profileEvidence = clip(rawProfile?.evidence, 200).replace(/^["“”']+|["“”']+$/g, '')
  if ((PROFILE_LABELS as readonly string[]).includes(label) && profileEvidence && isBackedByCustomer(profileEvidence, customerMessages)) {
    profile = { label, evidence: profileEvidence }
  }

  const objections: CallGuide['objections'] = []
  for (const item of Array.isArray(data.objections) ? data.objections : []) {
    const record = item as Record<string, unknown>
    const objection = clip(record?.objection, 160)
    const answer = clip(record?.answer, 400)
    if (!objection || !answer) continue
    const source = titles.get(normalizeText(clip(record?.source, 160))) ?? null
    objections.push({ objection, answer, source })
    if (objections.length === 3) break
  }

  return { opening: clip(data.opening, 240) || null, known, missing, profile, objections }
}
