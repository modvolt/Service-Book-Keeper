import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/ares/:ico", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.ico) ? req.params.ico[0] : req.params.ico;
  const ico = String(raw ?? "").replace(/\s+/g, "");
  if (!/^\d{6,8}$/.test(ico)) {
    res.status(400).json({ error: "Neplatné IČO" });
    return;
  }

  const padded = ico.padStart(8, "0");
  const url = `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${padded}`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (r.status === 404) { res.status(404).json({ error: "Subjekt nenalezen" }); return; }
    if (!r.ok) { res.status(502).json({ error: `ARES vrátil ${r.status}` }); return; }
    const data: any = await r.json();

    const sidlo = data?.sidlo ?? {};
    const addressParts = [
      sidlo.nazevUlice && `${sidlo.nazevUlice}${sidlo.cisloDomovni ? ` ${sidlo.cisloDomovni}${sidlo.cisloOrientacni ? `/${sidlo.cisloOrientacni}` : ""}` : ""}`,
      sidlo.psc && sidlo.nazevObce && `${sidlo.psc} ${sidlo.nazevObce}`,
    ].filter(Boolean);

    res.json({
      ico: data?.ico ?? padded,
      dic: data?.dic ?? null,
      name: data?.obchodniJmeno ?? "",
      address: addressParts.length ? addressParts.join(", ") : (sidlo.textovaAdresa ?? null),
    });
  } catch (err) {
    req.log.error({ err }, "ARES lookup failed");
    res.status(502).json({ error: "Chyba spojení s ARES" });
  }
});

export default router;
