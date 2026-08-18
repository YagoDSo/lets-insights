// Porte fiel do nó "Montar HTML1" (template Cerberus Hybrid, 600px, dark mode).
// Recebe a linha da edição (com json_* parseáveis).
//
// jul/2026: fim da divisão principais/cards. Agora é uma lista única de 4
// itens empilhados, no formato editorial do Brazil Journal: imagem cheia no
// topo, texto centralizado, "Leia mais" como link em negrito embutido na
// frase (sem botão) — o destaque do blog Lets primeiro, depois os 3 artigos
// selecionados. O blog usa "Ler artigo" (os artigos usam "Ler matéria") e
// entra com utm_content=blog; os demais usam noticia_N.
const CDN_LOGO = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/b50dc1d4-8f4c-42a7-8df1-f4fa39d98c24/87x86.png';
const ICON_LINKEDIN = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/edfb426e-900e-4c9a-866b-22ae164aeafe/48x48.png';
const ICON_FACEBOOK = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/98736dd2-68d2-4613-bdc5-024c87df3b29/48x48.png';
const ICON_INSTAGRAM = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/84c09a81-fb7b-4af7-a69b-596026bc4f85/48x48.png';
const ICON_SITE = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/9dbabf08-70a2-4b3b-ae0a-2c25d24d80d9/48x48.png';

// ─── Sanitização: todo texto/URL abaixo vem de RSS/scraping (fontes
// externas) reescrito pela IA, que parafraseia mas não garante remover
// HTML. Sem isso, um artigo malicioso injetaria HTML/links no e-mail
// enviado pra base inteira de assinantes. ──────────────────────────────
const ESCAPES_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ESCAPES_HTML[c]);

// Só aceita http(s); qualquer outro esquema (javascript:, data:, etc.) vira '#'.
const safeURL = (url) => {
  const s = String(url ?? '').trim();
  return /^https?:\/\//i.test(s) ? esc(s) : '#';
};

// Um item da lista (blog ou artigo), no formato editorial do Brazil Journal:
// imagem cheia no topo, texto centralizado, "Leia mais" como link em negrito
// embutido na frase (não botão). isLast controla o padding do divisor final;
// isBlog troca o texto do link e o utm_content.
const renderItem = (item, isLast, idx, isBlog) => {
  const padBaixo = isLast ? '0 32px 8px' : '0 32px';
  const textoLink = isBlog ? 'Ler artigo' : 'Ler matéria';
  const utmContent = isBlog ? 'blog' : `noticia_${idx}`;
  return `
  <tr>
    <td bgcolor="#ffffff" class="dm-body-bg" style="background-color:#ffffff;padding:24px 32px;" align="center">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding-bottom:14px;">
            <a href="${safeURL(item.url)}" target="_blank" style="text-decoration:none;"><img src="${safeURL(item.imagem)}" alt="${esc(item.categoria || 'Notícia')}" width="536" height="300" style="display:block;width:100%;max-width:536px;height:300px;object-fit:cover;border:0;margin:0 auto;" /></a>
          </td>
        </tr>
        <tr>
          <td align="center" style="text-align:center;">
            <div style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;color:#f15a22;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:8px;">
              ${esc(item.categoria || 'Notícia')}
            </div>
            <p class="dm-text-primary" style="margin:0 0 10px;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:400;font-size:14px;line-height:1.55;color:#12100b;">
              ${esc(item.titulo)} <a href="${safeURL(item.url)}?utm_source=newsletter&utm_medium=email&utm_campaign=insights&utm_content=${utmContent}" target="_blank" style="color:#f15a22;font-weight:700;text-decoration:none;white-space:nowrap;">&gt;&gt;&gt; ${textoLink}</a>
            </p>
            <div style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:11px;color:#a09ca2;">Fonte: ${esc(item.fonte)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr><td style="padding:${padBaixo};" class="dm-line"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:1px solid #f15a22;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
  `;
};

export function montarHTML(dados, opts = {}) {
  let selecionados, cta, blog;
  try { selecionados = JSON.parse(dados.json_artigos_principais); } catch (e) { throw new Error('Falha parsear json_artigos_principais: ' + e.message); }
  try { cta = JSON.parse(dados.json_cta); } catch (e) { throw new Error('Falha parsear json_cta: ' + e.message); }
  try { blog = JSON.parse(dados.json_blog); } catch (e) { throw new Error('Falha parsear json_blog: ' + e.message); }

  if (!Array.isArray(selecionados) || selecionados.length === 0) throw new Error('Edição sem artigos selecionados');
  if (!blog || !blog.titulo) throw new Error('Edição sem destaque de blog');

  // Teste A/B de posição do CTA (opts.ctaPosicao: 'inicio' | 'meio' | 'fim',
  // default 'fim' = comportamento original). Cada posição exige um texto
  // diferente porque a quantidade de conteúdo já "lido" quando o CTA aparece
  // muda: 'inicio' não pode referenciar nenhum artigo (nada foi mostrado
  // ainda, precisa ser pitch genérico da empresa); 'meio' pode referenciar
  // só os 2 primeiros itens (blog + 1º artigo); 'fim' pode referenciar a
  // edição inteira (comportamento normal, texto vem do json_cta da IA).
  // opts.ctaOverride injeta a copy quando não é 'fim'.
  const ctaPosicao = opts.ctaPosicao || 'fim';
  const ctaConteudo = opts.ctaOverride || cta;
  const ctaComKicker = ctaPosicao !== 'inicio'; // sem conteúdo anterior, não há "troca de registro" pra marcar
  const botaoMaior = ctaPosicao === 'inicio';

  const preHeader = dados.pre_header || '';

  const itens = [blog, ...selecionados];
  const renderSubset = (de, ate) =>
    itens
      .slice(de, ate)
      .map((item, i) => {
        const idx = de + i;
        return renderItem(item, idx === itens.length - 1, idx, idx === 0);
      })
      .join('');

  const botaoFontSize = botaoMaior ? '16px' : '13px';
  const botaoPadding = botaoMaior ? '20px 44px' : '16px 32px';
  const botaoAlturaMso = botaoMaior ? '60px' : '52px';
  const botaoLarguraMso = botaoMaior ? '360px' : '320px';

  // Espaço depois do bloco de CTA: 'inicio' segue reto pro 1º item (só um
  // respiro pequeno); 'meio' volta pro clima editorial com um divisor laranja
  // igual ao dos itens; 'fim' é o espaçador branco original antes do rodapé.
  const espacoDepoisCTA =
    ctaPosicao === 'inicio'
      ? `<tr><td style="height:8px;font-size:0;line-height:0;background-color:#ffffff;">&nbsp;</td></tr>`
      : ctaPosicao === 'meio'
        ? `<tr><td style="padding:0 40px 24px;background-color:#ffffff;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:1px solid #f15a22;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`
        : `<tr><td style="height:24px;font-size:0;line-height:0;background-color:#ffffff;">&nbsp;</td></tr>`;

  const ctaBlockHTML = `
          <tr>
            <td bgcolor="#ffffff" class="dm-editorial-bg" style="background-color:#ffffff;padding:36px 40px 40px;text-align:center;" align="center">
              ${!ctaComKicker ? '' : `<div class="dm-text-muted" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;color:#a09ca2;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:10px;">
                Let's
              </div>`}
              <div class="dm-text-primary" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:20px;line-height:1.25;color:#12100b;letter-spacing:-0.01em;margin-bottom:14px;max-width:460px;margin-left:auto;margin-right:auto;">
                ${esc(ctaConteudo.titulo)}
              </div>
              <p class="dm-text-body" style="margin:0 auto 24px;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:13.5px;line-height:1.6;color:#2f323b;max-width:460px;">
                ${esc(ctaConteudo.texto || '')}
              </p>
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://www.lets.com.br/solicitar-proposta" style="height:${botaoAlturaMso};v-text-anchor:middle;width:${botaoLarguraMso};" arcsize="8%" stroke="f" fillcolor="#f15a22"><w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI, Arial, sans-serif;font-size:${botaoFontSize};font-weight:bold;letter-spacing:1px">FALAR COM ESPECIALISTA</center></v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="https://www.lets.com.br/solicitar-proposta?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" target="_blank" style="background-color:#f15a22;color:#ffffff;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:${botaoFontSize};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;padding:${botaoPadding};border-radius:3px;display:inline-block;mso-hide:all;">FALAR COM ESPECIALISTA</a>
              <!--<![endif]-->
            </td>
          </tr>
          ${espacoDepoisCTA}
  `;

  const corpoHTML =
    ctaPosicao === 'inicio'
      ? `${ctaBlockHTML}${renderSubset(0, itens.length)}`
      : ctaPosicao === 'meio'
        ? `${renderSubset(0, 2)}${ctaBlockHTML}${renderSubset(2, itens.length)}`
        : `${renderSubset(0, itens.length)}${ctaBlockHTML}`;

  const html_final = `<!doctype html>
<html lang="pt-BR" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${esc(dados.titulo_edicao)}</title>

  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>* { font-family: 'Segoe UI', Arial, sans-serif !important; } table { border-collapse: collapse; } td { mso-line-height-rule: exactly; }</style>
  <![endif]-->

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700;0,800;1,800&display=swap" rel="stylesheet">

  <style type="text/css">
    html, body { margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
    body { background-color: #ffffff; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }
    a { text-decoration: none; color: #f15a22; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }

    @media screen and (max-width: 620px) {
      .mob-wrap { width: 100% !important; max-width: 100% !important; }
      .mob-pad-h { padding-left: 22px !important; padding-right: 22px !important; }
      .mob-stack { display: block !important; width: 100% !important; box-sizing: border-box; padding-left: 0 !important; padding-right: 0 !important; padding-bottom: 32px !important; }
      .mob-stack-last { padding-bottom: 0 !important; }
      .mob-img-full img { width: 100% !important; height: auto !important; max-width: 100% !important; }
      .mob-img-full { width: 100% !important; }
      .mob-center { text-align: center !important; }
      .mob-mt-16 { margin-top: 16px !important; }
      .mob-hide { display: none !important; }
      .mob-banner-pad { padding: 28px 18px 22px !important; }
    }

    @media (prefers-color-scheme: dark) {
      .dm-canvas-bg { background-color: #0a0a14 !important; }
      .dm-body-bg { background-color: #15151f !important; }
      .dm-editorial-bg { background-color: #1d1d2a !important; }
      .dm-text-primary { color: #f5f5f7 !important; }
      .dm-text-body { color: rgba(245,245,247,0.78) !important; }
      .dm-text-muted { color: rgba(245,245,247,0.55) !important; }
      .dm-line { border-color: rgba(255,255,255,0.10) !important; }
    }

    [data-ogsc] .dm-canvas-bg, [data-ogsb] .dm-canvas-bg { background-color: #0a0a14 !important; }
    [data-ogsc] .dm-body-bg, [data-ogsb] .dm-body-bg { background-color: #15151f !important; }
    [data-ogsc] .dm-editorial-bg, [data-ogsb] .dm-editorial-bg { background-color: #1d1d2a !important; }
    [data-ogsc] .dm-text-primary { color: #f5f5f7 !important; }
    [data-ogsc] .dm-text-body { color: rgba(245,245,247,0.78) !important; }
    [data-ogsc] .dm-text-muted { color: rgba(245,245,247,0.55) !important; }
    [data-ogsc] .dm-line { border-color: rgba(255,255,255,0.10) !important; }
  </style>
</head>

<body class="dm-canvas-bg" style="margin:0;padding:0;background-color:#ffffff;font-family:'Open Sans','Segoe UI',Arial,sans-serif;">

  <div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${esc(preHeader)}
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="dm-canvas-bg" style="background-color:#ffffff;">
    <tr>
      <td align="center" style="padding:24px 0;" class="mob-banner-pad">

        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" class="mob-wrap dm-body-bg" style="width:600px;max-width:600px;background-color:#ffffff;">

          <!-- TOPO 1C — editorial centralizado -->
          <tr>
            <td bgcolor="#ffffff" class="dm-body-bg" style="background-color:#ffffff;" align="center">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding:32px 32px 4px;text-align:center;">
                    <img src="${CDN_LOGO}" width="58" height="57" alt="Let's" style="display:inline-block;width:58px;height:57px;">
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 32px 22px;text-align:center;">
                    <span style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:800;font-size:42px;letter-spacing:-0.01em;color:#12100b;">Insights</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 28px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:2px solid #f15a22;font-size:0;line-height:0;">&nbsp;</td></tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${corpoHTML}

          <tr>
            <td bgcolor="#f15a22" style="background-color:#f15a22;padding:16px 32px;" valign="middle">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td valign="middle" width="50%" align="left" style="width:50%;text-align:left;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="144" align="left" style="width:144px;">
                      <tr>
                        <td align="left" style="text-align:left;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:12px;font-weight:700;color:#ffffff;letter-spacing:0.04em;padding-bottom:8px;">Siga a Let's</td>
                      </tr>
                      <tr>
                        <td align="left">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left">
                            <tr>
                              <td style="padding-right:10px;"><a href="https://www.linkedin.com/company/lets-frotas?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_LINKEDIN}" width="26" height="26" alt="LinkedIn" style="display:block;border:0;width:26px;height:26px;"></a></td>
                              <td style="padding-right:10px;"><a href="https://www.facebook.com/letsfrotas?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_FACEBOOK}" width="26" height="26" alt="Facebook" style="display:block;border:0;width:26px;height:26px;"></a></td>
                              <td style="padding-right:10px;"><a href="https://www.instagram.com/lets.frotas/?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_INSTAGRAM}" width="26" height="26" alt="Instagram" style="display:block;border:0;width:26px;height:26px;"></a></td>
                              <td><a href="https://www.lets.com.br/?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_SITE}" width="26" height="26" alt="Site" style="display:block;border:0;width:26px;height:26px;"></a></td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle" width="50%" align="right" style="width:50%;text-align:right;">
                    <a href="https://www.lets.com.br/?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=logo_footer" style="text-decoration:none;display:inline-block;"><img src="${CDN_LOGO}" width="44" height="44" alt="Lets" style="display:block;width:44px;height:44px;"></a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  // Remove quebras de linha do assunto: vira header de e-mail (Subject:), e
  // o titulo_edicao é influenciado por conteúdo externo (RSS) via a
  // reescrita da IA, então não dá pra confiar que nunca vem com \r\n.
  const semQuebraDeLinha = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

  const assunto = dados.titulo_edicao;

  return {
    edicao: dados.edicao,
    assunto_preview: semQuebraDeLinha(assunto),
    titulo_edicao: dados.titulo_edicao,
    pre_header: preHeader,
    html_final,
    qtd_itens: itens.length,
  };
}
