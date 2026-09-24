import { describe, expect, it } from "vitest";
import {
  buildMimeMessage,
  EmailValidationError,
  parseAddressList,
  toBase64Url,
  type MimeMessageInput,
} from "../../supabase/functions/_shared/mime.ts";

const base: MimeMessageInput = {
  from: { email: "ventas@example.cl", name: "Ventas SOC" },
  to: ["cliente@example.com"],
  subject: "Cotización COT-2026-0001",
  html: "<p>Hola</p>",
};

const decodeParts = (raw: string) =>
  raw.split("\r\n\r\n").slice(1).map((chunk) => {
    try { return Buffer.from(chunk.split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString("utf8"); } catch { return ""; }
  });

describe("parseAddressList", () => {
  it("separa por coma y recorta espacios", () => {
    expect(parseAddressList("a@example.cl, b@example.cl", "to")).toEqual(["a@example.cl", "b@example.cl"]);
  });

  it("rechaza direcciones inválidas, listas vacías y más de 50", () => {
    expect(() => parseAddressList("no-es-correo", "to")).toThrow(EmailValidationError);
    expect(() => parseAddressList(" , ", "to")).toThrow(EmailValidationError);
    expect(() => parseAddressList(Array.from({ length: 51 }, (_, i) => `u${i}@example.cl`), "to")).toThrow(EmailValidationError);
  });
});

describe("buildMimeMessage: inyección de encabezados", () => {
  const injections: Array<[string, MimeMessageInput]> = [
    ["asunto", { ...base, subject: "Hola\r\nBcc: espia@example.com" }],
    ["destinatario", { ...base, to: ["cliente@example.com\r\nBcc: espia@example.com"] }],
    ["nombre remitente", { ...base, from: { email: "ventas@example.cl", name: "Ventas\nBcc: espia@example.com" } }],
    ["in-reply-to", { ...base, inReplyTo: "<id@x>\r\nBcc: espia@example.com" }],
    ["nombre de adjunto", { ...base, attachments: [{ filename: "a.pdf\r\nX: y", contentType: "application/pdf", content: new Uint8Array([1]) }] }],
  ];

  for (const [field, input] of injections) {
    it(`rechaza saltos de línea en ${field}`, () => {
      expect(() => buildMimeMessage(input)).toThrow(EmailValidationError);
    });
  }

  it("rechaza un content-type de adjunto inválido", () => {
    expect(() => buildMimeMessage({ ...base, attachments: [{ filename: "a.pdf", contentType: "text/html; x=\"", content: new Uint8Array([1]) }] }))
      .toThrow(EmailValidationError);
  });
});

describe("buildMimeMessage: contenido", () => {
  it("codifica asunto y nombre con tildes, y el cuerpo en UTF-8", () => {
    const raw = buildMimeMessage({ ...base, from: { email: "ventas@example.cl", name: "Ingeniería SOC" } });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("From: =?UTF-8?B?");
    expect(raw).toContain("<ventas@example.cl>");
    expect(raw).toContain("multipart/alternative");
    expect(decodeParts(raw).some((part) => part.includes("<p>Hola</p>"))).toBe(true);
  });

  it("con adjunto arma multipart/mixed con el nombre del archivo", () => {
    const raw = buildMimeMessage({ ...base, attachments: [{ filename: "Cotización.pdf", contentType: "application/pdf", content: new Uint8Array([37, 80, 68, 70]) }] });
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain("filename*=UTF-8''Cotizaci%C3%B3n.pdf");
    expect(raw).toContain("JVBERg=="); // "%PDF" en base64
  });

  it("toBase64Url no deja caracteres fuera del alfabeto URL", () => {
    const encoded = toBase64Url("sujeto?>>>~~~");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
