// Company name and RUT for the commercial module, taken from what the
// conversation analysis extracted but only when it is literally backed by the
// customer's own messages: the model must never invent a RUT or a company.

import { cleanRut, findRutsInText, formatRut, isValidRut } from './rut.ts'

function normalizeText(value: string): string {
  return (value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const PLACEHOLDER_RE = /^(null|none|n\/?a|sin empresa|no aplica|particular|persona natural|desconocid[oa]|-)$/i

export interface CommercialFields {
  company_name?: string
  tax_id?: string
}

export function pickCommercialFields(
  extracted: { company_name?: unknown; tax_id?: unknown } | null | undefined,
  customerMessages: string[],
): CommercialFields {
  const result: CommercialFields = {}
  const texts = customerMessages.filter((text) => typeof text === 'string' && text.trim().length > 0)
  if (texts.length === 0) return result

  // RUT: the model's value if it is valid and was written by the customer;
  // otherwise, the single valid RUT found in the customer's messages.
  const compactTexts = texts.map((text) => text.toUpperCase().replace(/[.\-\s]/g, ''))
  const modelRut = typeof extracted?.tax_id === 'string' ? extracted.tax_id : ''
  if (modelRut && isValidRut(modelRut) && compactTexts.some((text) => text.includes(cleanRut(modelRut)))) {
    result.tax_id = formatRut(modelRut)
  } else {
    const inText = [...new Set(texts.flatMap(findRutsInText))]
    if (inText.length === 1) result.tax_id = inText[0]
  }

  // Company: kept only if its name appears in what the customer wrote.
  const company = typeof extracted?.company_name === 'string' ? extracted.company_name.trim() : ''
  const normalizedCompany = normalizeText(company)
  if (
    company.length >= 2 && company.length <= 120 &&
    !PLACEHOLDER_RE.test(company) &&
    normalizedCompany.length >= 2 &&
    texts.some((text) => ` ${normalizeText(text)} `.includes(` ${normalizedCompany} `))
  ) {
    result.company_name = company
  }

  return result
}
