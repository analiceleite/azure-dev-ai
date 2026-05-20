const axios = require('axios');

function requireEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(
      `Variável de ambiente obrigatória não definida: ${name}`
    );
  }
  return value.trim();
}

function parseAxiosProxy() {
  const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (!proxyUrl) {
    return false;
  }

  try {
    const url = new URL(proxyUrl);
    const proxy = {
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      protocol: url.protocol.replace(':', '')
    };
    if (url.username) {
      proxy.auth = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password || '')
      };
    }
    return proxy;
  } catch {
    return false;
  }
}

function getAuthConfig() {
  return {
    auth: { username: '', password: requireEnv('AZURE_DEVOPS_PAT') },
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
    proxy: parseAxiosProxy()
  };
}

function apiBase() {
  const org = requireEnv('AZURE_DEVOPS_ORG');
  const project = requireEnv('AZURE_DEVOPS_PROJECT');
  return `https://dev.azure.com/${org}/${encodeURIComponent(project)}`;
}

function isDescriptionEmpty(value) {
  if (!value || typeof value !== 'string') {
    return true;
  }
  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length === 0;
}

async function withRetry(operation, label, maxAttempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableRestError(error) || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = 800 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function getWorkItem(id) {
  const url =
    `${apiBase()}/_apis/wit/workitems/${id}?api-version=7.0`;

  const response = await withRetry(
    () => axios.get(url, getAuthConfig()),
    `getWorkItem(${id})`
  );
  const fields = response.data?.fields || {};

  return {
    id,
    title: fields['System.Title'] || '',
    description: fields['System.Description'] || '',
    workItemType: fields['System.WorkItemType'] || '',
    descriptionIsEmpty: isDescriptionEmpty(fields['System.Description'])
  };
}

async function patchWorkItem(id, document) {
  const url =
    `${apiBase()}/_apis/wit/workitems/${id}?api-version=7.0`;

  const response = await withRetry(
    () =>
      axios.patch(url, document, {
        ...getAuthConfig(),
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      }),
    `patchWorkItem(${id})`
  );

  return response.data;
}

async function updateDescriptionIfEmpty(id, descriptionHtml) {
  const workItem = await getWorkItem(id);
  if (!workItem.descriptionIsEmpty) {
    return { updated: false, reason: 'description_already_filled' };
  }

  const op = workItem.description ? 'replace' : 'add';
  await patchWorkItem(id, [
    {
      op,
      path: '/fields/System.Description',
      value: descriptionHtml
    }
  ]);

  return { updated: true };
}

async function addWorkItemComment(id, html, format = 'html') {
  const url =
    `${apiBase()}/_apis/wit/workItems/${id}/comments` +
    `?format=${encodeURIComponent(format)}&api-version=7.1-preview.4`;

  const response = await withRetry(
    () => axios.post(url, { text: html }, getAuthConfig()),
    `addWorkItemComment(${id})`
  );

  return {
    url: response.data?.url,
    commentId: response.data?.id,
    mode: 'rest'
  };
}

function isRetryableRestError(error) {
  const status = error.response?.status;
  const code = error.code;
  return (
    !status ||
    status === 401 ||
    status === 403 ||
    status === 407 ||
    status >= 500 ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET'
  );
}

async function publishWorkItemContent(id, { descriptionHtml, discussionHtml }) {
  const results = {
    mode: 'rest',
    description: { updated: false },
    discussion: null
  };

  if (descriptionHtml?.trim()) {
    results.description = await updateDescriptionIfEmpty(id, descriptionHtml);
  }

  if (!discussionHtml?.trim()) {
    throw new Error('discussionHtml vazio — nada para publicar na Discussion.');
  }

  results.discussion = await addWorkItemComment(id, discussionHtml, 'html');
  return results;
}

module.exports = {
  getWorkItem,
  isDescriptionEmpty,
  updateDescriptionIfEmpty,
  addWorkItemComment,
  publishWorkItemContent,
  isRetryableRestError,
  patchWorkItem,
  withRetry
};
