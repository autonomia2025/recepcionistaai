import { describe, expect, it } from "vitest";
import { findRutsInText, formatRut, isValidRut } from "../../supabase/functions/_shared/rut.ts";
import { pickCommercialFields } from "../../supabase/functions/_shared/commercialExtraction.ts";
import * as frontend from "@/lib/rut";

describe("RUT en funciones (igual que la pantalla)", () => {
  it("valida y formatea igual que src/lib/rut.ts", () => {
    let mismatches = 0;
    for (let body = 5_000_000; body < 5_004_000; body++) {
      for (const dv of ["0", "5", "K"]) {
        const value = `${body}${dv}`;
        if (isValidRut(value) !== frontend.isValidRut(value) || formatRut(value) !== frontend.formatRut(value)) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe("findRutsInText", () => {
  it("encuentra RUT con y sin puntos, con guion", () => {
    expect(findRutsInText("76644520-9 Soc ingenieria ltda")).toEqual(["76.644.520-9"]);
    expect(findRutsInText("mi rut es 76.644.520-9, gracias")).toEqual(["76.644.520-9"]);
    expect(findRutsInText("rut 11.111.111 - 1")).toEqual(["11.111.111-1"]);
  });

  it("ignora teléfonos, montos y RUT con dígito verificador malo", () => {
    expect(findRutsInText("mi número es 912345678")).toEqual([]);
    expect(findRutsInText("+56 9 8765 4321")).toEqual([]);
    expect(findRutsInText("presupuesto de $12.345.678")).toEqual([]);
    expect(findRutsInText("rut 76644520-1")).toEqual([]);
  });
});

describe("pickCommercialFields", () => {
  const joseLuis = ["hola necesito idrolavadra agua fria 220 volt", "76644520-9 Soc ingenieria ltda giro maquinaria direccion covarrubia 1752"];

  it("toma empresa y RUT cuando el cliente los escribió", () => {
    expect(pickCommercialFields({ company_name: "Soc Ingeniería Ltda", tax_id: "76644520-9" }, joseLuis))
      .toEqual({ company_name: "Soc Ingeniería Ltda", tax_id: "76.644.520-9" });
  });

  it("si la IA no trae el RUT, lo busca en los mensajes", () => {
    expect(pickCommercialFields({ company_name: null, tax_id: null }, joseLuis)).toEqual({ tax_id: "76.644.520-9" });
  });

  it("descarta un RUT que el cliente no escribió (inventado)", () => {
    expect(pickCommercialFields({ tax_id: "11.111.111-1" }, ["hola, quiero una hidrolavadora"])).toEqual({});
  });

  it("si la IA inventa un RUT pero el cliente escribió otro, usa el del cliente", () => {
    expect(pickCommercialFields({ tax_id: "11.111.111-1" }, joseLuis)).toEqual({ tax_id: "76.644.520-9" });
  });

  it("con dos RUT distintos en el texto y ninguno confirmado, no elige", () => {
    expect(pickCommercialFields({}, ["rut 76644520-9", "o factura a 11.111.111-1"])).toEqual({});
  });

  it("acepta el RUT de la IA si el cliente lo escribió sin guion", () => {
    expect(pickCommercialFields({ tax_id: "76.644.520-9" }, ["el rut es 766445209"])).toEqual({ tax_id: "76.644.520-9" });
  });

  it("descarta empresas que no aparecen en lo que escribió el cliente", () => {
    expect(pickCommercialFields({ company_name: "Agrícola del Sur SpA" }, ["trabajo en un campo en Osorno"])).toEqual({});
  });

  it("descarta respuestas de relleno como empresa", () => {
    expect(pickCommercialFields({ company_name: "null" }, ["null"])).toEqual({});
    expect(pickCommercialFields({ company_name: "particular" }, ["soy particular"])).toEqual({});
  });

  it("no calza una empresa dentro de otra palabra", () => {
    expect(pickCommercialFields({ company_name: "Soc" }, ["asociados"])).toEqual({});
  });

  it("sin mensajes del cliente no devuelve nada", () => {
    expect(pickCommercialFields({ company_name: "X", tax_id: "76644520-9" }, [])).toEqual({});
  });
});
