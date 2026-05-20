const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parseWorkItemContent } = require('./ado-content');
const { filterGitDataForTitle } = require('./git-relevance');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'workitem-prompt.txt');
const LLM_TIMEOUT_MS = 120000;

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

function loadSystemPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf-8');
}

function buildUserMessage(workItem, gitData) {
  const commitsBlock =
    gitData.commits.length > 0
      ? gitData.commits
          .map(
            (c) =>
              `- [${c.hash}] ${c.message} (${c.author}, ${c.date})`
          )
          .join('\n')
      : '- Nenhum commit relacionado encontrado na branch';

  const filesBlock =
    gitData.files.length > 0
      ? gitData.files
          .map((f) => `- ${f.status}\t${f.path}`)
          .join('\n')
      : '- Nenhum arquivo relacionado encontrado';

  const relevance = gitData.relevance
    ? `Tokens do título (amostra): ${gitData.relevance.titleTokens.join(', ')}\n` +
      `Commits no escopo filtrado: ${gitData.commits.length} (match direto: ${gitData.relevance.matchedCommits})\n` +
      `Arquivos no escopo filtrado: ${gitData.files.length} — USE ESTA LISTA na discussion\n`
    : '';

  return `
TÍTULO DO CARD (filtro obrigatório):
${workItem.title}

Tipo: ${workItem.workItemType || 'N/A'}
ID: ${workItem.id}
Descrição atual vazia: ${workItem.descriptionIsEmpty ? 'sim (preencher descriptionHtml)' : 'não (mesmo assim gere descriptionHtml coerente; o sistema só grava se estiver vazia)'}

${gitData.scopeNote || ''}

Repositório: ${gitData.repoPath}
Branch atual: ${gitData.branch}
Branch de trabalho: "${gitData.branch}" — commits/arquivos desde ${gitData.compareFrom || '?'} (${gitData.baseBranch || 'início da branch'})
Documente apenas o delta desta branch (${gitData.branch}), não o histórico completo do repositório.

Estatísticas: ${gitData.stats.filesChanged} arquivo(s) no escopo da branch

${relevance}
COMMITS na branch (filtrados por relevância ao título):
${commitsBlock}

ARQUIVOS na branch (filtrados por relevância ao título):
${filesBlock}

DIFF (trechos relacionados):
${gitData.diff || '(sem diff nos arquivos filtrados)'}
`.trim();
}

function getLlmConfig() {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '');
  const azureKey = process.env.AZURE_OPENAI_API_KEY;
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (azureEndpoint && azureKey && azureDeployment) {
    const apiVersion =
      process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
    return {
      provider: 'azure',
      url: `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=${apiVersion}`,
      headers: {
        'api-key': azureKey,
        'Content-Type': 'application/json'
      },
      model: azureDeployment
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    };
  }

  return null;
}

async function callChatCompletion(config, systemPrompt, userMessage) {
  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.2,
    max_tokens: 4096
  };

  if (config.provider === 'openai') {
    body.model = config.model;
  }

  const response = await axios.post(config.url, body, {
    headers: config.headers,
    timeout: LLM_TIMEOUT_MS,
    proxy: parseAxiosProxy()
  });

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error('O LLM retornou resposta vazia.');
  }

  return content.trim();
}

async function generateWorkItemContent(workItem, gitData) {
  const config = getLlmConfig();
  if (!config) {
    throw new Error(
      'LLM não configurado. Defina AZURE_OPENAI_* ou OPENAI_API_KEY no .env.'
    );
  }

  const narrowedGit = filterGitDataForTitle(gitData, workItem.title);
  const systemPrompt = loadSystemPrompt();
  const userMessage = buildUserMessage(workItem, narrowedGit);
  const raw = await callChatCompletion(config, systemPrompt, userMessage);

  try {
    const parsed = parseWorkItemContent(raw, workItem.title);
    return {
      ...parsed,
      workItemTitle: workItem.title,
      relevance: narrowedGit.relevance
    };
  } catch (error) {
    throw new Error(
      `Falha ao interpretar resposta do LLM: ${error.message}\n\nTrecho: ${raw.slice(0, 400)}`
    );
  }
}

module.exports = {
  generateWorkItemContent,
  buildUserMessage,
  filterGitDataForTitle
};
