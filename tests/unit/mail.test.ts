import { describe, expect, it } from "vitest";
import {
  buildEmailFragment, buildEmailHtml, buildEmailText, htmlToText, matchMessage, normalizeAddress, parseMailbox,
  recipientAddresses, safeFileName, splitReply,
} from "../../supabase/functions/_shared/mail.ts";
import { safeReturnUrl, signState, verifyState } from "../../supabase/functions/_shared/oauthState.ts";
import { defaultAnswerSubject, defaultQuoteMessage, defaultQuoteSubject } from "@/lib/quoteEmailText";

describe("el correo que recibe el cliente", () => {
  const sig = { sellerName: "Jorge Pérez", sellerEmail: "jorge@soc.cl", companyName: "SOC Ingeniería", phones: ["+56 9 1111 2222"], companyEmail: "ventas@soc.cl" };

  it("mensaje por defecto con el nombre del cliente y la vigencia", () => {
    expect(defaultQuoteMessage({ clientName: "María José Soto", quoteNumber: "COT-2026-0007", validityDays: 15 }))
      .toBe("Hola María,\n\nTe adjunto la cotización COT-2026-0007 que conversamos. Los precios están vigentes por 15 días.\n\nCualquier duda, respóndeme este correo y te ayudo.\n\nSaludos,");
    expect(defaultQuoteMessage({ clientName: null, quoteNumber: "COT-1", validityDays: null })).toMatch(/^Hola,\n\nTe adjunto la cotización COT-1 que conversamos\.\n/);
  });

  it("el HTML escapa lo que escribe el vendedor y firma con los datos de la empresa", () => {
    const html = buildEmailHtml("Hola <b>Ana</b>,\n\nPrecio & plazo\nsegunda línea", sig, "#123456");
    expect(html).toContain("Hola &lt;b&gt;Ana&lt;/b&gt;,");
    expect(html).toContain("Precio &amp; plazo<br>segunda línea");
    expect(html).toContain("<strong style=\"color:#222\">Jorge Pérez</strong><br>SOC Ingeniería<br>+56 9 1111 2222 · jorge@soc.cl");
    expect(html).toContain("#123456");
    expect(buildEmailHtml("x", sig, "red;background:url(x)")).not.toContain("url(x)");
    expect(buildEmailFragment("x", sig)).not.toContain("<html");
  });

  it("asuntos por defecto", () => {
    expect(defaultQuoteSubject("COT-2026-0007", "SOC Ingeniería")).toBe("Cotización COT-2026-0007 · SOC Ingeniería");
    expect(defaultQuoteSubject("COT-1", null)).toBe("Cotización COT-1");
    expect(defaultAnswerSubject("RE: Re: Cotización COT-1", "Consulta")).toBe("Re: Cotización COT-1");
    expect(defaultAnswerSubject("  ", "Consulta")).toBe("Re: Consulta");
  });

  it("texto plano con la misma firma", () => {
    expect(buildEmailText("Hola\n", { ...sig, sellerEmail: null, phones: [] })).toBe("Hola\n\n--\nJorge Pérez\nSOC Ingeniería\nventas@soc.cl");
  });
});

describe("la respuesta del cliente", () => {
  it("separa lo nuevo del historial citado (Gmail)", () => {
    const text = "Perfecto, ¿el despacho a Talca tiene costo?\n\nEl lun, 29 sept 2026 a las 10:02, Jorge Pérez · SOC Ingeniería <\nr-abc@cotizaciones.soc.cl> escribió:\n> Hola María,\n> Te adjunto...";
    const { fresh, quoted } = splitReply(text);
    expect(fresh).toBe("Perfecto, ¿el despacho a Talca tiene costo?");
    expect(quoted).toContain("> Hola María");
  });

  it("Outlook y 'Enviado desde mi iPhone'", () => {
    expect(splitReply("Ok, lo reviso.\n\nDe: Jorge <r-x@soc.cl>\nEnviado: lunes").fresh).toBe("Ok, lo reviso.");
    expect(splitReply("Dale\n\nEnviado desde mi iPhone").fresh).toBe("Dale");
  });

  it("sin historial devuelve todo; solo historial queda como citado", () => {
    expect(splitReply("Gracias!")).toEqual({ fresh: "Gracias!", quoted: null });
    expect(splitReply("> solo cita")).toEqual({ fresh: "", quoted: "> solo cita" });
  });

  it("convierte HTML a texto sin scripts", () => {
    expect(htmlToText("<style>p{}</style><p>Hola&nbsp;Jorge</p><div>Línea<br>dos</div><script>alert(1)</script>")).toBe("Hola Jorge\nLínea\ndos");
  });

  it("remitente con y sin nombre", () => {
    expect(parseMailbox('"María Soto" <Maria@Empresa.cl>')).toEqual({ name: "María Soto", email: "maria@empresa.cl" });
    expect(parseMailbox("maria@empresa.cl")).toEqual({ name: null, email: "maria@empresa.cl" });
  });

  it("nombres de archivo seguros", () => {
    expect(safeFileName("Orden de compra Nº 12 (firmada).pdf")).toBe("Orden_de_compra_N_12_firmada_.pdf");
    expect(safeFileName("../../x.pdf")).toBe("x.pdf");
    expect(safeFileName("")).toBe("adjunto");
  });
});

describe("a qué cliente pertenece un correo", () => {
  const contacts = new Map([["maria@agricola.cl", "c-maria"], ["juan@x.cl", "c-juan"]]);
  const threads = new Map([["conv-cot", { contact_id: "c-maria", quote_id: "q1", service_request_id: "r1" }]]);
  const base = { conversationId: null, to: [], cc: [] };

  it("entrante: solo si lo manda un cliente", () => {
    expect(matchMessage({ ...base, direction: "in", from: "maria@agricola.cl" }, "jorge@soc.cl", contacts, threads)?.contact_id).toBe("c-maria");
    expect(matchMessage({ ...base, direction: "in", from: "banco@notificaciones.cl", cc: ["maria@agricola.cl"] }, "jorge@soc.cl", contacts, threads)).toBeNull();
  });

  it("saliente: si va dirigido a un cliente (para o copia)", () => {
    expect(matchMessage({ ...base, direction: "out", from: "jorge@soc.cl", to: ["gerente@soc.cl"], cc: ["juan@x.cl"] }, "jorge@soc.cl", contacts, threads)?.contact_id).toBe("c-juan");
    expect(matchMessage({ ...base, direction: "out", from: "jorge@soc.cl", to: ["mama@gmail.com"] }, "jorge@soc.cl", contacts, threads)).toBeNull();
  });

  it("un hilo que el panel ya conoce gana, aunque el cliente responda desde otra dirección", () => {
    expect(matchMessage({ ...base, direction: "in", conversationId: "conv-cot", from: "otra@agricola.cl" }, "jorge@soc.cl", contacts, threads))
      .toEqual({ contact_id: "c-maria", quote_id: "q1", service_request_id: "r1" });
  });

  it("direcciones normalizadas", () => {
    expect(normalizeAddress(" Maria@Agricola.CL ")).toBe("maria@agricola.cl");
    expect(normalizeAddress("no es correo")).toBeNull();
    expect(recipientAddresses([{ emailAddress: { address: "A@x.cl" } }, { emailAddress: { address: "a@x.cl" } }, {}])).toEqual(["a@x.cl"]);
  });
});

describe("conexión con Outlook (state firmado)", () => {
  const payload = { userId: "u1", workshopId: "w1", returnTo: "https://recepcionistaai.lovable.app/my-day", issuedAt: 1_000_000, nonce: "n" };

  it("firma y verifica", async () => {
    const state = await signState(payload, "secreto");
    expect(await verifyState(state, "secreto", 15 * 60_000, 1_000_000 + 60_000)).toEqual(payload);
  });

  it("rechaza alterado, otra clave o vencido", async () => {
    const state = await signState(payload, "secreto");
    const [body, sig] = state.split(".");
    const forged = btoa(JSON.stringify({ ...payload, userId: "atacante" })).replace(/=+$/, "");
    expect(await verifyState(`${forged}.${sig}`, "secreto", 15 * 60_000, 1_000_000)).toBeNull();
    expect(await verifyState(state, "otra", 15 * 60_000, 1_000_000)).toBeNull();
    expect(await verifyState(state, "secreto", 15 * 60_000, 1_000_000 + 16 * 60_000)).toBeNull();
    expect(await verifyState(`${body}`, "secreto")).toBeNull();
    expect(await verifyState(null, "secreto")).toBeNull();
  });

  it("solo vuelve a la app, nunca a otro sitio", () => {
    const app = "https://recepcionistaai.lovable.app";
    expect(safeReturnUrl("https://recepcionistaai.lovable.app/requests", app)).toBe(`${app}/my-day`);
    expect(safeReturnUrl("https://id-preview--abc.lovable.app", app)).toBe("https://id-preview--abc.lovable.app/my-day");
    expect(safeReturnUrl("http://localhost:8765", app)).toBe("http://localhost:8765/my-day");
    expect(safeReturnUrl("https://evil.com", app)).toBe(`${app}/my-day`);
    expect(safeReturnUrl("https://lovable.app.evil.com", app)).toBe(`${app}/my-day`);
    expect(safeReturnUrl("javascript:alert(1)", app)).toBe(`${app}/my-day`);
    expect(safeReturnUrl(null, app)).toBe(`${app}/my-day`);
  });
});
