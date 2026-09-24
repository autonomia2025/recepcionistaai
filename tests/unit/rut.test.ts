import { describe, expect, it } from "vitest";
import { cleanRut, formatRut, isValidRut } from "@/lib/rut";

// Reference implementation written independently from src/lib/rut.ts, so a
// shared mistake in both cannot make the tests pass.
function checkDigit(body: number): string {
  const digits = String(body).split("").reverse().map(Number);
  const weights = [2, 3, 4, 5, 6, 7];
  const sum = digits.reduce((acc, digit, index) => acc + digit * weights[index % 6], 0);
  const rest = 11 - (sum % 11);
  return rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
}

describe("isValidRut", () => {
  it("acepta RUT conocidos con y sin formato", () => {
    for (const rut of ["11.111.111-1", "111111111", "12.345.678-5", "12345678-5", " 12.345.678-5 "]) {
      expect(isValidRut(rut), rut).toBe(true);
    }
  });

  it("rechaza dígito verificador incorrecto", () => {
    expect(isValidRut("11.111.111-2")).toBe(false);
    expect(isValidRut("12.345.678-K")).toBe(false);
  });

  it("acepta K mayúscula y minúscula, y 0 cuando corresponde", () => {
    const withK = Array.from({ length: 2000 }, (_, i) => 5_000_000 + i).find((body) => checkDigit(body) === "K")!;
    const withZero = Array.from({ length: 2000 }, (_, i) => 5_000_000 + i).find((body) => checkDigit(body) === "0")!;
    expect(isValidRut(`${withK}-K`)).toBe(true);
    expect(isValidRut(`${withK}-k`)).toBe(true);
    expect(isValidRut(`${withZero}-0`)).toBe(true);
    expect(isValidRut(`${withZero}-K`)).toBe(false);
  });

  it("coincide con la implementación de referencia en miles de casos", () => {
    let mismatches = 0;
    for (let body = 1_000_000; body < 1_000_000 + 5_000; body++) {
      const good = checkDigit(body);
      const bad = good === "1" ? "2" : "1";
      if (!isValidRut(`${body}-${good}`) || isValidRut(`${body}-${bad}`)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it("rechaza vacíos y basura", () => {
    for (const value of ["", "1", "K", "abc", "K-1", "12.3K5.678-5"]) {
      expect(isValidRut(value), value).toBe(false);
    }
  });
});

describe("cleanRut / formatRut", () => {
  it("limpia puntos, guion y espacios, y sube la K", () => {
    expect(cleanRut(" 7.654.321-k ")).toBe("7654321K");
  });

  it("formatea con puntos y guion", () => {
    expect(formatRut("111111111")).toBe("11.111.111-1");
    expect(formatRut("123456785")).toBe("12.345.678-5");
    expect(formatRut("1k")).toBe("1-K");
    expect(formatRut("1")).toBe("1");
  });
});
