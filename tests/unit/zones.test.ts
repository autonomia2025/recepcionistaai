import { describe, expect, it } from "vitest";
import {
  buildZonePromptSection,
  detectZoneFromText,
  type WorkshopZone,
  zoneEmail,
  zoneKeys,
} from "../../supabase/functions/_shared/zones.ts";

const ZONES: WorkshopZone[] = [
  { key: "talca", label: "Talca / Maule", notification_email: "talca@example.cl", aliases: ["talca", "maule", "curicó", "san javier"] },
  { key: "puerto_montt", label: "Puerto Montt", notification_email: null, aliases: ["puerto montt", "pto. montt", "osorno"] },
  { key: "santiago", label: "Santiago / RM", notification_email: "", aliases: ["santiago", "maipú", "rm"] },
];

describe("detectZoneFromText", () => {
  it("detecta por alias ignorando mayúsculas y tildes (en ambos lados)", () => {
    expect(detectZoneFromText(ZONES, "Hola, estoy en CURICO")).toBe("talca");
    expect(detectZoneFromText(ZONES, "vivo en Maipu")).toBe("santiago");
    expect(detectZoneFromText(ZONES, "somos de San Javier")).toBe("talca");
  });

  it("acepta alias con puntuación", () => {
    expect(detectZoneFromText(ZONES, "despacho a pto. montt")).toBe("puerto_montt");
  });

  it("no calza dentro de otras palabras", () => {
    expect(detectZoneFromText(ZONES, "necesito que firmen la cotización")).toBeNull(); // "rm" dentro de "firmen"
    expect(detectZoneFromText(ZONES, "lo usamos con el sistema erm")).toBeNull(); // letra antes del alias
    expect(detectZoneFromText(ZONES, "hablé con el Sr. Maulén")).toBeNull(); // letra después del alias
    expect(detectZoneFromText(ZONES, "busco una hidrolavadora")).toBeNull();
  });

  it("gana la primera zona configurada cuando hay dos menciones", () => {
    expect(detectZoneFromText(ZONES, "estoy en Santiago pero la planta está en Talca")).toBe("talca");
  });

  it("ignora zonas sin alias y alias vacíos", () => {
    const zones: WorkshopZone[] = [
      { key: "vacia", label: "Vacía", notification_email: null, aliases: ["", "  "] },
      ...ZONES,
    ];
    expect(detectZoneFromText(zones, "estoy en osorno")).toBe("puerto_montt");
    expect(detectZoneFromText([], "talca")).toBeNull();
  });
});

describe("helpers de zonas", () => {
  it("zoneKeys y zoneEmail", () => {
    expect(zoneKeys(ZONES)).toEqual(["talca", "puerto_montt", "santiago"]);
    expect(zoneEmail(ZONES, "talca")).toBe("talca@example.cl");
    expect(zoneEmail(ZONES, "puerto_montt")).toBeNull();
    expect(zoneEmail(ZONES, "no_existe")).toBeNull();
  });

  it("el prompt lista las claves válidas y cae a null sin zonas", () => {
    const prompt = buildZonePromptSection(ZONES);
    expect(prompt).toContain("talca, puerto_montt, santiago");
    expect(prompt).toContain('zone = "puerto_montt"');
    expect(buildZonePromptSection([])).toContain("zone = null");
  });
});
