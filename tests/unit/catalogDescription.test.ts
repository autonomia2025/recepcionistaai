import { describe, expect, it } from "vitest";
import { catalogLineDescription } from "@/lib/catalogDescription";

// Expected strings are what public.catalog_line_description returned in the
// migration harness for f2_t2_quote_draft.
describe("catalogLineDescription (igual que la base)", () => {
  it("agua caliente, 220V, con temperatura", () => {
    expect(catalogLineDescription({ water_type: "AGUA CALIENTE", motor_type: "ELÉCTRICA 220V", pressure_bar: "130", flow_lmin: "10", temp_max: "90" }))
      .toBe("Hidrolavadora agua caliente · eléctrica 220V · 130 bar · 10 L/min · temp. máx. 90°C");
  });

  it("sin temperatura (vacía)", () => {
    expect(catalogLineDescription({ water_type: "AGUA FRÍA", motor_type: "ELÉCTRICA 220V", pressure_bar: "100", flow_lmin: "7", temp_max: "" }))
      .toBe("Hidrolavadora agua fría · eléctrica 220V · 100 bar · 7 L/min");
  });

  it("diésel, temperatura nula", () => {
    expect(catalogLineDescription({ water_type: "AGUA FRÍA", motor_type: "DIÉSEL", pressure_bar: "250", flow_lmin: "15", temp_max: null }))
      .toBe("Hidrolavadora agua fría · diésel · 250 bar · 15 L/min");
  });

  it("temperatura '—' no se imprime y faltan datos", () => {
    expect(catalogLineDescription({ water_type: null, motor_type: null, pressure_bar: "120", flow_lmin: null, temp_max: "—" }))
      .toBe("Hidrolavadora · 120 bar");
  });
});
