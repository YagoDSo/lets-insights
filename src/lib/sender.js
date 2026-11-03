import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// ─────────────────────────────────────────────────────────────
// Camada de envio. HOJE: Gmail (preview). DEPOIS: E-goi (produção).
// Trocar de provedor = adicionar um branch aqui; as etapas não mudam.
// ─────────────────────────────────────────────────────────────
export async function enviarPreview({ assunto, html, anexos, para }) {
  // Modo de teste: grava o e-mail em disco em vez de enviar.
  if (config.modoTeste) {
    const dir = path.join(config.testeDir, 'preview', String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'corpo.html'), html);
    fs.writeFileSync(path.join(dir, 'assunto.txt'), `${assunto}\nPara: ${para || config.previewTo || '(não definido)'}\n`);
    for (const a of anexos || []) fs.writeFileSync(path.join(dir, a.filename), a.content);
    console.log(`[MODO TESTE] E-mail não enviado; gravado em ${dir} (${(anexos || []).length} anexo(s)).`);
    return `teste-${path.basename(dir)}`;
  }
  if (config.sender === 'gmail') {
    if (!config.gmailUser || !config.gmailAppPassword) {
      throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD não configurados (.env ou Secrets).');
    }
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    });
    const info = await transporter.sendMail({
      from: `"Lets Insights Newsletter Bot" <${config.gmailUser}>`,
      to: para || config.previewTo,
      subject: assunto,
      html,
      attachments: (anexos || []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: 'text/html',
      })),
    });
    return info.messageId;
  }

  // Placeholder pra produção futura.
  if (config.sender === 'egoi') {
    throw new Error('Envio via E-goi ainda não implementado. Configure SENDER=gmail por enquanto.');
  }

  throw new Error(`SENDER desconhecido: "${config.sender}".`);
}
