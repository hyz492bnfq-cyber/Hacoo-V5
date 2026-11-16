'use strict';

const HACOO_HOSTS = ['hacoo.app', 'hacoo.pl', 'onlyaff.app'];
const URL_PATTERN = /(?:^|[^\p{L}\p{N}_.-])((?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:hacoo\.app|hacoo\.pl|onlyaff\.app)(?::\d+)?(?:[/?#][^\s<>"']*)?)(?![\p{L}\p{N}.-])/giu;

function isHacooUrl(value) {
  const raw = String(value || '').trim().replace(/[),.!?;:]+$/u, '');
  if (!raw) return false;
  try {
    const url = new URL(/^https?:\/\//iu.test(raw) ? raw : 'https://' + raw.replace(/^www\./iu, ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    return HACOO_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
  } catch {
    return false;
  }
}

function hasHacooLink(message = {}) {
  const content = String(message.text || message.caption || '');
  URL_PATTERN.lastIndex = 0;
  if (URL_PATTERN.test(content)) return true;
  URL_PATTERN.lastIndex = 0;
  const entities = [
    ...(Array.isArray(message.entities) ? message.entities : []),
    ...(Array.isArray(message.caption_entities) ? message.caption_entities : [])
  ];
  return entities.some(entity => entity && (
    (entity.type === 'text_link' && isHacooUrl(entity.url)) ||
    (entity.type === 'url' && Number.isInteger(entity.offset) && Number.isInteger(entity.length) &&
      isHacooUrl(content.slice(entity.offset, entity.offset + entity.length)))
  ));
}

function normalizeRules(value) {
  const rows = Array.isArray(value) ? value : [];
  const byChat = new Map();
  for (const item of rows) {
    const chatId = String(item?.chatId ?? '').trim();
    if (!/^-?\d{1,20}$/u.test(chatId)) continue;
    const text = String(item?.text || '').replace(/\u0000/g, '').slice(0, 600);
    byChat.set(chatId, { chatId, enabled: item?.enabled === true, text });
  }
  return [...byChat.values()].slice(-100);
}

function appendConfiguredText(message = {}, rule = {}) {
  const source = String(message.text || message.caption || '');
  const suffix = String(rule.text || '').replace(/\u0000/g, '').trim().slice(0, 600);
  const hasMedia = Boolean(message.photo || message.video || message.document || message.animation || message.audio || message.voice || message.video_note);
  const field = message.caption !== undefined || hasMedia ? 'caption' : 'text';
  if (rule.enabled !== true || !suffix || !hasHacooLink(message)) {
    return { changed: false, text: source, field, reason: 'not-applicable' };
  }
  if (source.includes(suffix)) {
    return { changed: false, text: source, field, reason: 'already-appended' };
  }
  const maxLength = field === 'caption' ? 1024 : 4096;
  const text = source + (source.trimEnd() ? '\n\n' : '') + suffix;
  if (text.length > maxLength) {
    return { changed: false, text: source, field, reason: 'telegram-limit' };
  }
  return { changed: true, text, field, reason: null };
}

async function editOriginalMessage(api, message, result) {
  if (!api || !message?.chat?.id || !message.message_id || !result?.changed) {
    throw new TypeError('Paramètres insuffisants pour modifier le message Telegram.');
  }
  if (result.field === 'caption') {
    return api.editMessageCaption(message.chat.id, message.message_id, result.text, {
      caption_entities: Array.isArray(message.caption_entities) ? message.caption_entities : []
    });
  }
  return api.editMessageText(message.chat.id, message.message_id, result.text, {
    entities: Array.isArray(message.entities) ? message.entities : []
  });
}

module.exports = { HACOO_HOSTS, isHacooUrl, hasHacooLink, normalizeRules, appendConfiguredText, editOriginalMessage };
