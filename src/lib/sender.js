import nodemailer from 'nodemailer';
import { config } from './config.js';

// ─────────────────────────────────────────────────────────────
// Camada de envio. HOJE: Gmail (preview). DEPOIS: E-goi (produção).
// Trocar de provedor = adicionar um branch aqui; as etapas não mudam.
// ─────────────────────────────────────────────────────────────
export async function enviarPreview({ assunto, html, anexoNome, anexoConteudo, para }) {
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
      attachments: anexoConteudo
        ? [{ filename: anexoNome, content: anexoConteudo, contentType: 'text/html' }]
        : [],
    });
    return info.messageId;
  }

  // Placeholder pra produção futura.
  if (config.sender === 'egoi') {
    throw new Error('Envio via E-goi ainda não implementado. Configure SENDER=gmail por enquanto.');
  }

  throw new Error(`SENDER desconhecido: "${config.sender}".`);
}
