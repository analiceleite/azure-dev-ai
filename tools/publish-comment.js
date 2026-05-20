const { updateWorkItem: updateViaBrowser } = require('./azure-browser-update');
const {
  updateWorkItem: updateViaRest,
  isRetryableRestError
} = require('./azure-rest-update');
const { htmlToPlainText } = require('./ado-content');

function getPublishMode() {
  const mode = (process.env.AZURE_PUBLISH_MODE || 'browser').toLowerCase();
  if (['browser', 'rest', 'auto'].includes(mode)) {
    return mode;
  }
  return 'browser';
}

function normalizePayload(content) {
  if (typeof content === 'string') {
    return {
      descriptionHtml: null,
      discussionHtml: `<p>${content}</p>`,
      discussionPlain: content
    };
  }

  return {
    descriptionHtml: content.descriptionHtml || null,
    discussionHtml: content.discussionHtml,
    discussionPlain: htmlToPlainText(content.discussionHtml)
  };
}

async function publishComment(id, content) {
  const mode = getPublishMode();
  const hasPat = Boolean(process.env.AZURE_DEVOPS_PAT?.trim());
  const payload = normalizePayload(content);

  if (mode === 'browser') {
    return updateViaBrowser(id, payload);
  }

  if (mode === 'rest') {
    if (!hasPat) {
      throw new Error(
        'AZURE_PUBLISH_MODE=rest requer AZURE_DEVOPS_PAT no .env.'
      );
    }
    return updateViaRest(id, payload);
  }

  if (hasPat) {
    try {
      return updateViaRest(id, payload);
    } catch (error) {
      if (isRetryableRestError(error)) {
        console.error(
          `[azure-dev-ai] REST falhou (${error.message}); tentando browser...`
        );
        return updateViaBrowser(id, payload);
      }
      throw error;
    }
  }

  return updateViaBrowser(id, payload);
}

module.exports = {
  publishComment,
  getPublishMode
};
