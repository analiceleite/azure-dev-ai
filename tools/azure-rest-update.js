const {
  publishWorkItemContent,
  isRetryableRestError
} = require('./ado-rest-client');

async function updateWorkItem(id, content) {
  if (typeof content === 'string') {
    return publishWorkItemContent(id, {
      descriptionHtml: null,
      discussionHtml: `<p>${content}</p>`
    });
  }

  return publishWorkItemContent(id, content);
}

module.exports = {
  updateWorkItem,
  isRetryableRestError,
  publishWorkItemContent
};
