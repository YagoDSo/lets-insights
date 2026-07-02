// Porte fiel do nó "Montar HTML1" (template Cerberus Hybrid, 600px, dark mode).
// Recebe a linha da edição (com json_* parseáveis) + postBlogRecente do scraping.
const FALLBACK_BLOG_IMG =
  'https://cdn.prod.website-files.com/67d2cd7e700eb793f98a2e81/6a04acd2772388e00bdf5a8d_Gemini_Generated_Image_nmyoe6nmyoe6nmyo.png';

const CDN_LOGO = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/b50dc1d4-8f4c-42a7-8df1-f4fa39d98c24/87x86.png';
const ICON_LINKEDIN = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/edfb426e-900e-4c9a-866b-22ae164aeafe/48x48.png';
const ICON_FACEBOOK = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/98736dd2-68d2-4613-bdc5-024c87df3b29/48x48.png';
const ICON_INSTAGRAM = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/84c09a81-fb7b-4af7-a69b-596026bc4f85/48x48.png';
const ICON_SITE = 'https://cdn.mcauto-images-production.sendgrid.net/aead0c601c58f7b7/9dbabf08-70a2-4b3b-ae0a-2c25d24d80d9/48x48.png';

const formatarEdicaoExtenso = (edicaoStr) => {
  const meses = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const hoje = new Date();
  const dia = String(hoje.getDate()).padStart(2, '0');
  const mes = meses[hoje.getMonth()];
  const ano = hoje.getFullYear();
  return `EDIÇÃO ${edicaoStr} · ${dia} ${mes} ${ano}`;
};

const renderPrincipal = (art, isLast, idx) => {
  const padBaixo = isLast ? '0 32px 8px' : '0 32px';
  return `
  <tr>
    <td bgcolor="#ffffff" class="dm-body-bg" style="background-color:#ffffff;padding:30px 32px;" align="left">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td valign="top" width="160" class="mob-stack mob-img-full" style="width:160px;padding-right:22px;">
            <a href="${art.url}" target="_blank" style="text-decoration:none;"><img src="${art.imagem}" alt="${art.categoria || 'Notícia'}" width="160" height="160" style="display:block;width:160px;height:160px;border-radius:6px;object-fit:cover;border:0;" /></a>
          </td>
          <td valign="top" class="mob-stack mob-mt-16">
            <div style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:10.5px;font-weight:700;color:#f15a22;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:8px;">
              ${art.categoria || 'Notícia'}
            </div>
            <div class="dm-text-primary" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:17px;letter-spacing:0.04em;text-transform:uppercase;color:#12100b;line-height:1.2;margin-bottom:10px;">
              ${art.subtitulo}
            </div>
            <p class="dm-text-body" style="margin:0 0 14px;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.55;color:#4a4a52;">
              ${art.resumo}
            </p>
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${art.url}" style="height:44px;v-text-anchor:middle;width:150px;" arcsize="8%" stroke="f" fillcolor="#f15a22"><w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.5px;">Ler matéria</center></v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${art.url}?utm_source=newsletter&utm_medium=email&utm_campaign=insights&utm_content=principal_${idx + 1}" target="_blank" style="background-color:#f15a22;color:#ffffff;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.04em;text-decoration:none;padding:10px 20px;border-radius:3px;display:inline-block;mso-hide:all;">Ler matéria</a>
            <!--<![endif]-->
            <div style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:11px;color:#888;margin-top:10px;">Fonte: ${art.fonte}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr><td style="padding:${padBaixo};" class="dm-line"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:1px solid #f15a22;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
  `;
};

const renderCard = (art, idx) => `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr><td><a href="${art.url}" target="_blank" style="text-decoration:none;"><img src="${art.imagem}" alt="${art.categoria || 'Notícia'}" width="100%" height="120" style="display:block;width:100%;height:120px;object-fit:cover;border:0;" /></a></td></tr>
      <tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="dm-text-primary" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#12100b;padding-bottom:10px;">${art.categoria || 'Notícia'}</td></tr>
      <tr><td class="dm-text-body" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#4a4a52;padding-bottom:14px;">${art.resumo}</td></tr>
      <tr><td>
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${art.url}" style="height:44px;v-text-anchor:middle;width:150px;" arcsize="8%" stroke="f" fillcolor="#f15a22"><w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.5px;">Ler matéria</center></v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${art.url}?utm_source=newsletter&utm_medium=email&utm_campaign=insights&utm_content=card_${idx + 1}" target="_blank" style="background-color:#f15a22;color:#ffffff;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.04em;text-decoration:none;padding:10px 20px;border-radius:3px;display:inline-block;mso-hide:all;">Ler matéria</a>
        <!--<![endif]-->
      </td></tr>
      <tr><td style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:11px;color:#888;padding-top:10px;">Fonte: ${art.fonte}</td></tr>
    </table>
`;

export function montarHTML(dados) {
  let principais, cards, cta;
  try { principais = JSON.parse(dados.json_artigos_principais); } catch (e) { throw new Error('Falha parsear json_artigos_principais: ' + e.message); }
  try { cards = JSON.parse(dados.json_artigos_cards); } catch (e) { throw new Error('Falha parsear json_artigos_cards: ' + e.message); }
  try { cta = JSON.parse(dados.json_cta); } catch (e) { throw new Error('Falha parsear json_cta: ' + e.message); }

  if (!Array.isArray(principais) || principais.length === 0) throw new Error('Edição sem artigos principais');
  if (!Array.isArray(cards) || cards.length === 0) throw new Error('Edição sem artigos cards');
  if (!cta || !cta.titulo) throw new Error('CTA inválido');

  const postScraping = dados.postBlogRecente;
  const blogPost = postScraping && postScraping.titulo
    ? { titulo: postScraping.titulo, url: postScraping.url, imagem: postScraping.imagem || FALLBACK_BLOG_IMG }
    : { titulo: 'Confira novos conteúdos sobre gestão de frota no blog Lets.', url: 'https://www.lets.com.br/blog', imagem: FALLBACK_BLOG_IMG };

  const edicaoFormatada = formatarEdicaoExtenso(dados.edicao);
  const preHeader = dados.pre_header || '';

  const principaisHTML = principais
    .slice(0, 3)
    .map((art, idx, arr) => renderPrincipal(art, idx === arr.length - 1, idx))
    .join('');

  const cardBlog = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f15a22" style="background-color:#f15a22;border-radius:4px;">
      <tr>
        <td style="padding:2px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" class="dm-body-bg" style="background-color:#ffffff;border-radius:3px;">
            <tr><td><a href="${blogPost.url}" target="_blank" style="text-decoration:none;display:block;"><img src="${blogPost.imagem}" alt="Blog Lets" width="100%" height="120" style="display:block;width:100%;height:120px;object-fit:cover;border:0;" /></a></td></tr>
            <tr><td style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td style="padding:0 12px;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#f15a22;">★ Última do Blog Lets</td></tr>
            <tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td class="dm-text-primary" style="padding:0 12px;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:13.5px;line-height:1.35;color:#12100b;">${blogPost.titulo}</td></tr>
            <tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td style="padding:0 12px 14px 12px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${blogPost.url}" style="height:44px;v-text-anchor:middle;width:150px;" arcsize="8%" stroke="f" fillcolor="#f15a22"><w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.5px;">Ler artigo</center></v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${blogPost.url}" target="_blank" style="background-color:#f15a22;color:#ffffff;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.04em;text-decoration:none;padding:10px 20px;border-radius:3px;display:inline-block;mso-hide:all;">Ler artigo</a>
              <!--<![endif]-->
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
`;

  const card0 = cards[0] ? renderCard(cards[0], 0) : '';
  const card1 = cards[1] ? renderCard(cards[1], 1) : '';
  const card2 = cards[2] ? renderCard(cards[2], 2) : '';

  const gridCards = `
          <tr>
            <td bgcolor="#ffffff" class="dm-body-bg" style="background-color:#ffffff;padding:24px 32px 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td valign="top" width="50%" class="mob-stack" style="width:50%;padding-right:14px;">${cardBlog}</td>
                  <td valign="top" width="50%" class="mob-stack mob-stack-last" style="width:50%;padding-left:14px;">${card0}</td>
                </tr>
              </table>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="mob-hide"><tr><td style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td valign="top" width="50%" class="mob-stack" style="width:50%;padding-right:14px;">${card1}</td>
                  <td valign="top" width="50%" class="mob-stack mob-stack-last" style="width:50%;padding-left:14px;">${card2}</td>
                </tr>
              </table>
            </td>
          </tr>
`;

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
  <title>${dados.titulo_edicao}</title>

  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>* { font-family: 'Segoe UI', Arial, sans-serif !important; } table { border-collapse: collapse; } td { mso-line-height-rule: exactly; }</style>
  <![endif]-->

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700;0,800;1,800&display=swap" rel="stylesheet">

  <style type="text/css">
    html, body { margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
    body { background-color: #e9e9ec; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
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

<body class="dm-canvas-bg" style="margin:0;padding:0;background-color:#e9e9ec;font-family:'Open Sans','Segoe UI',Arial,sans-serif;">

  <div style="display:none;font-size:1px;color:#e9e9ec;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${preHeader}
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="dm-canvas-bg" style="background-color:#e9e9ec;">
    <tr>
      <td align="center" style="padding:24px 0;" class="mob-banner-pad">

        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" class="mob-wrap dm-body-bg" style="width:600px;max-width:600px;background-color:#ffffff;">

          <!-- TOPO LARANJA -->
          <tr>
            <td bgcolor="#f15a22" style="background-color:#f15a22;padding:28px 32px;" valign="middle" class="mob-banner-pad">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td valign="middle" align="left">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="middle" style="padding-right:12px;"><img src="${CDN_LOGO}" width="36" height="36" alt="Lets" style="display:block;width:36px;height:36px;"></td>
                        <td valign="middle" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:22px;color:#ffffff;letter-spacing:-0.005em;">Insights</td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle" align="right" class="mob-hide" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;text-align:right;">
                    <div style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:13px;color:#ffffff;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;line-height:1.2;">${edicaoFormatada}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${principaisHTML}

          ${gridCards}

          <tr>
            <td bgcolor="#eeeeef" class="dm-editorial-bg" style="background-color:#eeeeef;padding:36px 40px 40px;text-align:center;" align="center">
              <div class="dm-text-primary" style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:800;font-size:20px;line-height:1.25;color:#12100b;letter-spacing:-0.01em;margin-bottom:14px;max-width:460px;margin-left:auto;margin-right:auto;">
                ${cta.titulo}
              </div>
              <p class="dm-text-body" style="margin:0 auto 24px;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:13.5px;line-height:1.6;color:#4a4a52;max-width:460px;">
                ${cta.texto || ''}
              </p>
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://www.lets.com.br/solicitar-proposta" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="8%" stroke="f" fillcolor="#f15a22"><w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI, Arial, sans-serif;font-size:13px;font-weight:bold;letter-spacing:1px">FALAR COM ESPECIALISTA</center></v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="https://www.lets.com.br/solicitar-proposta?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" target="_blank" style="background-color:#f15a22;color:#ffffff;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;padding:16px 32px;border-radius:3px;display:inline-block;mso-hide:all;">FALAR COM ESPECIALISTA</a>
              <!--<![endif]-->
            </td>
          </tr>


          <tr><td style="height:24px;font-size:0;line-height:0;background-color:#e9e9ec;">&nbsp;</td></tr>

          <tr>
            <td bgcolor="#f15a22" style="background-color:#f15a22;padding:32px 32px 28px;color:#ffffff;">
              <!--[if mso]>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="504"><tr>
              <td valign="top" width="232" style="width:232px;padding-right:20px;vertical-align:top;">
              <![endif]-->
              <div class="mob-stack" style="display:inline-block;vertical-align:top;width:100%;max-width:232px;">
                <div style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:700;font-size:14px;color:#ffffff;letter-spacing:0.04em;margin-bottom:14px;">Siga a Lets</div>
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                  <tr>
                    <td style="padding-right:8px;"><a href="https://www.linkedin.com/company/lets-frotas?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_LINKEDIN}" width="26" height="26" alt="LinkedIn" style="display:block;border:0;width:26px;height:26px;"></a></td>
                    <td style="padding-right:8px;"><a href="https://www.facebook.com/letsfrotas?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_FACEBOOK}" width="26" height="26" alt="Facebook" style="display:block;border:0;width:26px;height:26px;"></a></td>
                    <td style="padding-right:8px;"><a href="https://www.instagram.com/lets.frotas/?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_INSTAGRAM}" width="26" height="26" alt="Instagram" style="display:block;border:0;width:26px;height:26px;"></a></td>
                    <td><a href="https://www.lets.com.br/?utm_source=egoi&utm_medium=email&utm_campaign=newsletter&utm_content=botao_cta" style="text-decoration:none;"><img src="${ICON_SITE}" width="26" height="26" alt="Site" style="display:block;border:0;width:26px;height:26px;"></a></td>
                  </tr>
                </table>
                <p style="margin:0;font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:11.5px;line-height:1.55;color:rgba(255,255,255,0.85);">Você recebe Lets Insights porque se cadastrou em lets.com.br ou interagiu com nossa equipe.</p>
              </div>
              <!--[if mso]>
              </td>
              <td valign="top" width="232" style="width:232px;padding-left:20px;vertical-align:top;">
              <![endif]-->
              <div class="mob-stack mob-mt-16" style="display:inline-block;vertical-align:top;width:100%;max-width:232px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr><td style="padding-bottom:14px;"><img src="${CDN_LOGO}" width="44" height="44" alt="Lets" style="display:block;width:44px;height:44px;"></td></tr>
                  <tr><td style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-weight:800;font-size:15px;color:#ffffff;letter-spacing:0.02em;padding-bottom:10px;">Lets · Gestão de Frotas</td></tr>
                  <tr><td style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.55;color:rgba(255,255,255,0.85);padding-bottom:18px;">Av. Jerônimo Vervloet, 345<br>Maria Ortiz, Vitória ES</td></tr>
                  <tr><td style="font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:10.5px;line-height:1.5;color:rgba(255,255,255,0.85);letter-spacing:0.02em;">Lets é uma empresa do portfólio VIXPar, Grupo Águia Branca.</td></tr>
                </table>
              </div>
              <!--[if mso]>
              </td></tr></table>
              <![endif]-->
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  return {
    edicao: dados.edicao,
    assunto_preview: `[Ed. ${dados.edicao}] ${dados.titulo_edicao}`,
    titulo_edicao: dados.titulo_edicao,
    pre_header: preHeader,
    html_final,
    qtd_principais: principais.length,
    qtd_cards: cards.length,
    tem_blog_destaque: !!postScraping,
  };
}
