import { describe, expect, it } from "vitest";
import { buildProductEvents } from "../../supabase/functions/_shared/productEvents.ts";

const catalogSkus = new Set(["SOC25015ACDC2", "PWPC12011M", "SOC17013EF"]);
const base = { customerCodes: [], chosenCode: null, replies: [], datasheets: [], catalogSkus };

describe("buildProductEvents", () => {
  it("registra lo que el cliente escribió, solo si existe en el catálogo", () => {
    const events = buildProductEvents({ ...base, customerCodes: ["SOC250/15ACD-C2", "SOC999/99X"] });
    expect(events).toEqual([{ event_type: "customer_asked", sku_normalized: "SOC25015ACDC2", detail: { as_written: "SOC250/15ACD-C2" } }]);
  });

  it("registra los equipos que el bot mostró, sin repetir", () => {
    const replies = ["A) *SOC250/15ACD-C2* — 250 bar\nB) *PWPC120-11M* — 120 bar", "La SOC250/15ACD-C2 es la más completa"];
    const events = buildProductEvents({ ...base, replies });
    expect(events.map((e) => [e.event_type, e.sku_normalized])).toEqual([
      ["recommended", "SOC25015ACDC2"],
      ["recommended", "PWPC12011M"],
    ]);
  });

  it("ignora códigos inventados, medidas y voltajes en la respuesta", () => {
    const events = buildProductEvents({ ...base, replies: ["Te ofrezco la SOC999/99X, 250 bar, eléctrica 380V"] });
    expect(events).toEqual([]);
  });

  it("registra la opción elegida del menú", () => {
    const events = buildProductEvents({ ...base, chosenCode: "PWPC120-11M" });
    expect(events).toEqual([{ event_type: "chosen", sku_normalized: "PWPC12011M", detail: {} }]);
  });

  it("una elección que no está en el catálogo no se registra", () => {
    expect(buildProductEvents({ ...base, chosenCode: "B" })).toEqual([]);
    expect(buildProductEvents({ ...base, chosenCode: null })).toEqual([]);
  });

  it("registra fichas enviadas, con o sin modelo vinculado", () => {
    const events = buildProductEvents({
      ...base,
      datasheets: [
        { file_name: "SOC170-13EF.pdf", sku_normalized: "SOC17013EF" },
        { file_name: "Catalogo general.pdf", sku_normalized: null },
      ],
    });
    expect(events).toEqual([
      { event_type: "datasheet_sent", sku_normalized: "SOC17013EF", detail: { file_name: "SOC170-13EF.pdf" } },
      { event_type: "datasheet_sent", sku_normalized: null, detail: { file_name: "Catalogo general.pdf" } },
    ]);
  });

  it("un turno completo: pidió, se mostró, eligió y se envió la ficha", () => {
    const events = buildProductEvents({
      customerCodes: ["soc170-13ef"],
      chosenCode: "SOC170-13EF",
      replies: ["Perfecto, la *SOC170-13EF* tiene 170 bar."],
      datasheets: [{ file_name: "SOC170-13EF.pdf", sku_normalized: "SOC17013EF" }],
      catalogSkus,
    });
    expect(events.map((e) => e.event_type)).toEqual(["customer_asked", "chosen", "recommended", "datasheet_sent"]);
  });

  it("sin catálogo no registra modelos (no puede verificarlos)", () => {
    const events = buildProductEvents({ ...base, catalogSkus: new Set(), customerCodes: ["SOC250/15ACD-C2"], replies: ["SOC250/15ACD-C2"] });
    expect(events).toEqual([]);
  });
});
