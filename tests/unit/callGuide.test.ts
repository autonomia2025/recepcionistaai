import { describe, expect, it } from "vitest";
import { isBackedByCustomer, sanitizeCallGuide } from "../../supabase/functions/_shared/callGuide.ts";

const customer = [
  "Hola, necesito una hidrolavadora para lavar una sala de ordeña",
  "B",
  "Mi empresa es Pruebas JT SpA, RUT 76.644.520-9. Cotízame esa por favor",
  "la necesito antes de fin de mes, es urgente",
];

describe("isBackedByCustomer", () => {
  it("acepta frases del cliente sin importar tildes ni mayúsculas", () => {
    expect(isBackedByCustomer("sala de ordena", customer)).toBe(true);
    expect(isBackedByCustomer("“antes de fin de mes”", customer)).toBe(true);
  });

  it("rechaza frases inventadas, de una sola palabra o cortadas dentro de una palabra", () => {
    expect(isBackedByCustomer("tengo 200 vacas", customer)).toBe(false);
    expect(isBackedByCustomer("urgente", customer)).toBe(false);
    expect(isBackedByCustomer("la de ordeña", customer)).toBe(false);
  });
});

describe("sanitizeCallGuide", () => {
  const raw = {
    opening: "Hola JT, te llamo por la hidrolavadora para la sala de ordeña que cotizaste.",
    known: [
      { fact: "Es para una sala de ordeña", evidence: "lavar una sala de ordeña" },
      { fact: "Tiene 200 vacas", evidence: "tengo 200 vacas" },
      { fact: "Necesita el equipo este mes", evidence: "antes de fin de mes" },
      { fact: "", evidence: "sala de ordeña" },
    ],
    missing: ["Dirección de despacho", "Dirección de despacho", "¿Tiene espacio para la caldera?", "", 42],
    profile: { label: "Apurado", evidence: "es urgente" },
    objections: [
      { objection: "El precio es alto", answer: "El vapor sanitiza mejor y reduce tiempo de lavado.", source: "Argumentos agua caliente" },
      { objection: "Prefiere agua fría", answer: "La proteína de la leche no sale en frío.", source: "Documento que no existe" },
      { objection: "", answer: "sin objeción" },
    ],
  };

  it("guarda solo hechos respaldados por el cliente", () => {
    const guide = sanitizeCallGuide(raw, customer, ["Argumentos agua caliente"]);
    expect(guide.known.map((k) => k.fact)).toEqual(["Es para una sala de ordeña", "Necesita el equipo este mes"]);
  });

  it("limpia y deduplica lo que falta preguntar", () => {
    expect(sanitizeCallGuide(raw, customer, []).missing).toEqual(["Dirección de despacho", "¿Tiene espacio para la caldera?"]);
  });

  it("acepta un perfil conocido con evidencia y rechaza uno sin respaldo", () => {
    expect(sanitizeCallGuide(raw, customer, []).profile).toEqual({ label: "apurado", evidence: "es urgente" });
    expect(sanitizeCallGuide({ ...raw, profile: { label: "apurado", evidence: "me urge mucho" } }, customer, []).profile).toBeNull();
    expect(sanitizeCallGuide({ ...raw, profile: { label: "millonario", evidence: "es urgente" } }, customer, []).profile).toBeNull();
  });

  it("solo cita documentos del argumentario que existen", () => {
    const guide = sanitizeCallGuide(raw, customer, ["Argumentos agua caliente"]);
    expect(guide.objections.map((o) => o.source)).toEqual(["Argumentos agua caliente", null]);
  });

  it("tolera una respuesta vacía o rota de la IA", () => {
    expect(sanitizeCallGuide(null, customer, [])).toEqual({ opening: null, known: [], missing: [], profile: null, objections: [] });
    expect(sanitizeCallGuide({ known: "no es lista", objections: [null] }, customer, []).known).toEqual([]);
  });
});
