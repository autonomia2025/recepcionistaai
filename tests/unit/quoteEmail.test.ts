import { describe, expect, it } from "vitest";
import {
  buildEmailHtml, buildEmailText, extractReplyToken, formatFrom, htmlToText, isValidSenderLocal,
  newReplyToken, nextEmailStatus, normalizeDomain, parseMailbox, replyAddress, safeFileName, senderDisplayName,
  splitReply, verifyWebhookSignature,
} from "../../supabase/functions/_shared/quoteEmail.ts";
import { defaultAnswerSubject, defaultQuoteMessage, defaultQuoteSubject } from "@/lib/quoteEmailText";

describe("normalizeDomain", () => {
  it("acepta lo que la gente escribe y deja solo el dominio", () => {
    expect(normalizeDomain("https://www.Soc.cl/")).toBe("www.soc.cl");
    expect(normalizeDomain("ventas@cotizaciones.soc.cl")).toBe("cotizaciones.soc.cl");
    expect(normalizeDomain(" cotizaciones.soc.cl. ")).toBe("cotizaciones.soc.cl");
  });

  it("rechaza lo que no es un dominio", () => {
    expect(normalizeDomain("soc")).toBeNull();
    expect(normalizeDomain("soc .cl")).toBeNull();
    expect(normalizeDomain("-soc.cl")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("dirección de respuesta", () => {
  it("el token es aleatorio y cabe en una dirección", () => {
    const a = newReplyToken();
    expect(a).toMatch(/^[a-z0-9]{24}$/);
    expect(newReplyToken()).not.toBe(a);
  });

  it("encuentra el token entre los destinatarios, con o sin nombre", () => {
    const token = "abcdefghij0123456789klmn";
    const domain = "cotizaciones.soc.cl";
    expect(replyAddress(token, domain)).toBe(`r-${token}@${domain}`);
    expect(extractReplyToken(["otro@gmail.com", `Jorge <R-${token.toUpperCase()}@Cotizaciones.Soc.cl>`], domain)).toBe(token);
    expect(extractReplyToken([`r-${token}@otro.cl`], domain)).toBeNull();
    expect(extractReplyToken(["cotizaciones@cotizaciones.soc.cl"], domain)).toBeNull();
    expect(extractReplyToken(["r-corto@cotizaciones.soc.cl", null, 3], domain)).toBeNull();
  });

  it("el remitente no puede parecerse a una dirección de respuesta", () => {
    expect(isValidSenderLocal("cotizaciones")).toBe(true);
    expect(isValidSenderLocal("r-algo")).toBe(false);
    expect(isValidSenderLocal("Ventas")).toBe(false);
  });
});

describe("remitente", () => {
  it("nombre del vendedor y de la empresa, sin caracteres peligrosos", () => {
    expect(senderDisplayName("Jorge Pérez", "SOC Ingeniería")).toBe("Jorge Pérez · SOC Ingeniería");
    expect(senderDisplayName(null, "SOC Ingeniería")).toBe("SOC Ingeniería");
    expect(formatFrom('Jorge "<x>"\r\nBcc: a@b.cl', "c@soc.cl")).toBe('"Jorge x Bcc: a@b.cl" <c@soc.cl>');
    expect(formatFrom("", "c@soc.cl")).toBe("c@soc.cl");
  });
});

describe("firma del webhook (esquema Svix)", () => {
  // Vector de prueba publicado por Svix.
  const secret = "whsec_plJ3nmyCDGBKInavdOK15jsl";
  const body = '{"event_type":"ping","data":{"success":true}}';
  const headers = { id: "msg_loFOjxBNrRLzqYUf", timestamp: "1731705121", signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" };

  it("acepta la firma correcta dentro del plazo", async () => {
    expect(await verifyWebhookSignature(secret, headers, body, 1731705121 + 10)).toBe(true);
    expect(await verifyWebhookSignature(secret, { ...headers, signature: `v1,xxxx ${headers.signature}` }, body, 1731705121)).toBe(true);
  });

  it("rechaza cuerpo alterado, firma ajena, hora vieja o datos faltantes", async () => {
    expect(await verifyWebhookSignature(secret, headers, body.replace("true", "false"), 1731705121)).toBe(false);
    expect(await verifyWebhookSignature("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", headers, body, 1731705121)).toBe(false);
    expect(await verifyWebhookSignature(secret, headers, body, 1731705121 + 3600)).toBe(false);
    expect(await verifyWebhookSignature(secret, { ...headers, signature: null }, body, 1731705121)).toBe(false);
    expect(await verifyWebhookSignature("", headers, body, 1731705121)).toBe(false);
  });
});

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
  });

  it("asuntos por defecto", () => {
    expect(defaultQuoteSubject("COT-2026-0007", "SOC Ingeniería")).toBe("Cotización COT-2026-0007 · SOC Ingeniería");
    expect(defaultQuoteSubject("COT-1", null)).toBe("Cotización COT-1");
    expect(defaultAnswerSubject("RE: Re: Cotización COT-1", "COT-1")).toBe("Re: Cotización COT-1");
    expect(defaultAnswerSubject(null, "COT-1")).toBe("Re: Cotización COT-1");
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

describe("estado de entrega", () => {
  it("no retrocede", () => {
    expect(nextEmailStatus("sending", "sent")).toBe("sent");
    expect(nextEmailStatus("delivered", "sent")).toBe("delivered");
    expect(nextEmailStatus("sent", "bounced")).toBe("bounced");
    expect(nextEmailStatus("sent", "opened")).toBe("sent");
  });
});
