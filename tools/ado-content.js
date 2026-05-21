function extractJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Resposta do LLM não contém JSON válido.');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeHtml(value, fieldName) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new Error(`Campo "${fieldName}" ausente na resposta do LLM.`);
  }

  let html = value.trim();
  if (html.includes('```')) {
    throw new Error(
      `Campo "${fieldName}" contém markdown; use apenas HTML simples.`
    );
  }

  return html;
}

function normalizeComparableText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function textsMatchTitle(candidate, title) {
  const a = normalizeComparableText(candidate);
  const b = normalizeComparableText(title);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 12 && longer.includes(shorter)) {
    return shorter.length / longer.length >= 0.65;
  }
  return false;
}

function stripInnerHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove título duplicado no início da Descrição (o WI já tem campo Título).
 */
/**
 * Garante um único parágrafo HTML simples (<p>...</p>).
 */
function enforceSingleParagraphHtml(html) {
  let result = html.trim();

  result = result
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, ' ')
    .replace(/<ul[^>]*>[\s\S]*?<\/ul>/gi, ' ')
    .replace(/<ol[^>]*>[\s\S]*?<\/ol>/gi, ' ')
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ');

  const paragraphTexts = [...result.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (match) => stripInnerHtml(match[1])
  );

  const plain =
    paragraphTexts.filter(Boolean).join(' ') || stripInnerHtml(result);

  if (!plain) {
    return '<p></p>';
  }

  return `<p>${plain}</p>`;
}

function sanitizeDescriptionHtml(html, title) {
  if (!html?.trim() || !title?.trim()) {
    return html;
  }

  let result = html.trim();

  for (let pass = 0; pass < 3; pass++) {
    const before = result;

    const heading = result.match(/^(?:<h[12][^>]*>)([\s\S]*?)(?:<\/h[12]>)\s*/i);
    if (heading && textsMatchTitle(stripInnerHtml(heading[1]), title)) {
      result = result.slice(heading[0].length).trim();
    }

    const paragraph = result.match(/^(?:<p[^>]*>)([\s\S]*?)(?:<\/p>)\s*/i);
    if (paragraph && textsMatchTitle(stripInnerHtml(paragraph[1]), title)) {
      result = result.slice(paragraph[0].length).trim();
    }

    if (result === before) {
      break;
    }
  }

  return result.trim() || html.trim();
}

function parseWorkItemContent(llmText, workItemTitle) {
  const parsed = extractJsonObject(llmText);
  let descriptionHtml = normalizeHtml(
    parsed.descriptionHtml,
    'descriptionHtml'
  );

  if (workItemTitle) {
    descriptionHtml = sanitizeDescriptionHtml(descriptionHtml, workItemTitle);
  }

  descriptionHtml = enforceSingleParagraphHtml(descriptionHtml);
  const discussionHtml = enforceSingleParagraphHtml(
    normalizeHtml(parsed.discussionHtml, 'discussionHtml')
  );

  return {
    descriptionHtml,
    discussionHtml
  };
}

function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<h[1-6][^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  parseWorkItemContent,
  sanitizeDescriptionHtml,
  enforceSingleParagraphHtml,
  htmlToPlainText
};
