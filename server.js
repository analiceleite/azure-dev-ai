const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  Server
} = require('@modelcontextprotocol/sdk/server/index.js');

const {
  StdioServerTransport
} = require('@modelcontextprotocol/sdk/server/stdio.js');

const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const { getGitSummary } = require('./tools/git-summary');
const { generateWorkItemContent } = require('./tools/summary-generator');
const { getWorkItem } = require('./tools/ado-rest-client');
const { publishComment } = require('./tools/publish-comment');
const { htmlToPlainText } = require('./tools/ado-content');

const server = new Server(
  {
    name: 'azure-dev-ai',
    version: '1.2.1'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

function toolError(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  };
}

function toolSuccess(text) {
  return {
    content: [{ type: 'text', text }]
  };
}

function validateWorkItemId(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Parâmetro "id" é obrigatório.');
  }
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `ID do work item inválido: "${id}". Use apenas dígitos (ex.: 10186).`
    );
  }
  return trimmed;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'update_azure_card',
      description:
        'Atualiza um card do Azure DevOps com base no TÍTULO do work item: ' +
        'preenche a Descrição (se vazia) com o conceito do título e publica na Discussion ' +
        'somente o que foi implementado no código para resolver aquele problema (HTML legível).',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID numérico do Work Item no Azure Boards (ex.: 10186)'
          },
          repoPath: {
            type: 'string',
            description:
              'Caminho opcional do repositório Git. Padrão: GIT_REPO_PATH ou diretório atual.'
          }
        },
        required: ['id']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  if (toolName !== 'update_azure_card') {
    return toolError(`Tool não encontrada: ${toolName}`);
  }

  try {
    const args = request.params.arguments || {};
    const workItemId = validateWorkItemId(args.id);
    const repoPath = args.repoPath;

    const workItem = await getWorkItem(workItemId);
    const gitData = await getGitSummary(repoPath);
    const content = await generateWorkItemContent(workItem, gitData);
    const publishResult = await publishComment(workItemId, {
      descriptionHtml: content.descriptionHtml,
      discussionHtml: content.discussionHtml
    });

    const modeLabel =
      publishResult.mode === 'rest' ? 'API REST' : 'navegador (Playwright)';

    const descriptionNote = publishResult.description?.updated
      ? 'Descrição preenchida (estava vazia).'
      : 'Descrição mantida (já existia).';

    return toolSuccess(
      `Card ${workItemId} atualizado via ${modeLabel}.\n\n` +
        `Título: ${workItem.title}\n` +
        `Branch de trabalho: ${gitData.branch}\n` +
        `${descriptionNote}\n` +
        `Escopo Git: alterações em ${gitData.branch} desde ${gitData.compareFrom} (${gitData.baseBranch}).\n` +
        `Filtro título: ${content.relevance?.matchedFiles ?? 0} arquivo(s), ` +
        `${content.relevance?.matchedCommits ?? 0} commit(s).\n\n` +
        `--- Discussion (texto) ---\n\n${htmlToPlainText(content.discussionHtml)}`
    );
  } catch (error) {
    let message = error.message || String(error);
    if (error.screenshotPath) {
      message += `\n\nScreenshot: ${error.screenshotPath}`;
    }
    return toolError(message);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Azure Dev AI MCP iniciado');
}

main().catch((error) => {
  console.error('Falha ao iniciar MCP:', error);
  process.exit(1);
});
