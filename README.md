# azure-dev-ai

MCP server para o Cursor que atualiza cards do Azure DevOps com um resumo técnico gerado a partir do contexto Git da branch atual.

## O que faz

A tool `update_azure_card`:

1. Lê o **título** do work item no Azure DevOps
2. Lê o Git da branch e **filtra** commits/arquivos/diff relevantes ao título
3. Gera via LLM dois blocos em **HTML** (não markdown cru):
   - **Descrição** (só se estiver vazia): o que o título pede, para PO/dev
   - **Discussion**: apenas o que foi feito no código para resolver **aquele** título
4. Publica com `format=html` na API REST (ou browser em fallback)

## Pré-requisitos

- Node.js 18+
- Git instalado
- Acesso ao Azure DevOps (SSO corporativo ou PAT)
- Chave de API do Azure OpenAI ou OpenAI

## Instalação

```bash
npm install
npx playwright install chromium
```

Copie o arquivo de ambiente:

```bash
copy .env.example .env
```

Edite `.env` com org, projeto, credenciais LLM e proxy (se necessário).

## Configuração no Cursor

Adicione em `~/.cursor/mcp.json` ou `.cursor/mcp.json` do projeto (veja [mcp.json.example](mcp.json.example)):

```json
{
  "mcpServers": {
    "azure-dev-ai": {
      "command": "node",
      "args": ["C:/caminho/absoluto/para/azure-dev-ai/server.js"],
      "env": {
        "GIT_REPO_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

Se `${workspaceFolder}` não for expandido na sua versão do Cursor, use o caminho absoluto do projeto que você está editando.

Reinicie o Cursor após salvar a configuração.

## Primeiro login no Azure (modo browser)

Com `AZURE_PUBLISH_MODE=browser` (padrão):

1. Defina `AZURE_BROWSER_HEADLESS=false` no `.env`
2. Execute manualmente uma atualização ou abra o perfil em `.azure-browser-profile`
3. Faça login no `dev.azure.com` quando o navegador abrir
4. A sessão fica salva no perfil persistente do Playwright

## Proxy

Configure no `.env`:

```
HTTP_PROXY=http://seu-proxy:porta
HTTPS_PROXY=http://seu-proxy:porta
PLAYWRIGHT_PROXY=http://seu-proxy:porta
```

Para ambientes corporativos, use também:

```
PLAYWRIGHT_BROWSER_CHANNEL=msedge
```

## Modos de publicação

| Modo | Comportamento |
|------|----------------|
| `browser` | Playwright abre o card, insere comentário e salva (padrão) |
| `rest` | API REST com `AZURE_DEVOPS_PAT` |
| `auto` | Tenta REST; em falha de rede/auth, usa browser |

## Uso no Cursor

Exemplo de prompt:

> Atualize o card 10187 com o que foi implementado para o título do card

O agente chama `update_azure_card({ "id": "10186" })`.

Parâmetro opcional `repoPath` se o Git não estiver no workspace padrão.

## Variáveis de ambiente

Consulte [.env.example](.env.example) para a lista completa.

## Estrutura

```
server.js                 # MCP stdio server
tools/
  git-summary.js          # Coleta contexto Git
  summary-generator.js    # Gera resumo via LLM
  azure-browser-update.js # Publicação via Playwright
  azure-rest-update.js    # Publicação via API REST
  publish-comment.js      # Orquestra browser/rest/auto
prompts/
  workitem-prompt.txt     # Instruções do resumo
```

## Solução de problemas

| Problema | Ação |
|----------|------|
| Repositório Git inválido | Configure `GIT_REPO_PATH` no mcp.json |
| LLM não configurado | Preencha Azure OpenAI ou `OPENAI_API_KEY` |
| Tela de login Azure | Faça login manual com `AZURE_BROWSER_HEADLESS=false` |
| Discussão não encontrada | Verifique screenshot em `screenshots/` |
| REST bloqueado por proxy | Use `AZURE_PUBLISH_MODE=browser` |

## Desenvolvimento

```bash
npm start
```

O servidor usa transporte stdio (não HTTP) — é iniciado pelo Cursor, não manualmente em uso normal.
