const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { htmlToPlainText } = require('./ado-content');

const DEFAULT_USER_DATA_DIR = path.join(
  __dirname,
  '..',
  '.azure-browser-profile'
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(
      `Variável de ambiente obrigatória não definida: ${name}`
    );
  }
  return value.trim();
}

function buildWorkItemUrl(id) {
  const org = requireEnv('AZURE_DEVOPS_ORG');
  const project = requireEnv('AZURE_DEVOPS_PROJECT');
  const encodedProject = encodeURIComponent(project);
  return `https://dev.azure.com/${org}/${encodedProject}/_workitems/edit/${id}`;
}

function getBrowserLaunchOptions() {
  const headless = process.env.AZURE_BROWSER_HEADLESS !== 'false';
  const channel =
    process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined;

  const options = {
    headless,
    channel: channel || undefined
  };

  const proxyServer =
    process.env.PLAYWRIGHT_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY;

  if (proxyServer) {
    options.proxy = { server: proxyServer };
  }

  return options;
}

function getUserDataDir() {
  const dir =
    process.env.PLAYWRIGHT_USER_DATA_DIR || DEFAULT_USER_DATA_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizePayload(content) {
  if (typeof content === 'string') {
    return { descriptionHtml: null, discussionPlain: content };
  }

  return {
    descriptionHtml: content.descriptionHtml || null,
    discussionPlain: htmlToPlainText(content.discussionHtml || '')
  };
}

async function isLoginPage(page) {
  const url = page.url();
  if (
    url.includes('login.microsoftonline.com') ||
    url.includes('login.live.com') ||
    url.includes('/_signin')
  ) {
    return true;
  }

  const signInButton = page.locator(
    'input[type="submit"], button:has-text("Sign in"), button:has-text("Entrar")'
  );
  return (await signInButton.count()) > 0;
}

async function openDiscussionEditor(page) {
  const selectors = [
    '[aria-label="Start a discussion"]',
    '[aria-label*="discussion" i]',
    '[aria-label*="discussão" i]',
    'button:has-text("New comment")',
    'button:has-text("Novo comentário")',
    '[data-focuszone-id] [contenteditable="true"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.click({ timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(500);
    }
  }

  const editorSelectors = [
    '[aria-label="Start a discussion"]',
    '[aria-label*="discussion" i]',
    '[contenteditable="true"]',
    'textarea[aria-label*="comment" i]',
    '.discussion-editor textarea',
    '.discussion-editor [contenteditable="true"]'
  ];

  for (const selector of editorSelectors) {
    const editor = page.locator(selector).first();
    if ((await editor.count()) > 0) {
      await editor.waitFor({ state: 'visible', timeout: 15000 });
      return editor;
    }
  }

  throw new Error(
    'Não foi possível localizar o editor de Discussão no Azure Boards.'
  );
}

async function insertComment(page, editor, content) {
  await editor.click();
  await page.keyboard.press('Control+A').catch(() => null);
  await page.keyboard.press('Meta+A').catch(() => null);

  try {
    await editor.fill(content);
    return;
  } catch {
    // contenteditable
  }

  await page.evaluate(
    ({ text }) => {
      const active = document.activeElement;
      if (active && 'innerText' in active) {
        active.innerText = text;
        active.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    { text: content }
  );
}

async function clickSave(page) {
  const saveSelectors = [
    'button:has-text("Save")',
    'button:has-text("Salvar")',
    '[aria-label="Save"]',
    '[aria-label="Salvar"]'
  ];

  for (const selector of saveSelectors) {
    const button = page.locator(selector).first();
    if ((await button.count()) > 0) {
      await button.click({ timeout: 10000 });
      await page.waitForTimeout(2000);
      return;
    }
  }

  throw new Error('Botão Save/Salvar não encontrado no work item.');
}

async function captureErrorScreenshot(page, id) {
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const filePath = path.join(
    screenshotDir,
    `workitem-${id}-${Date.now()}.png`
  );
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => null);
  return filePath;
}

async function updateWorkItem(id, content) {
  const payload = normalizePayload(content);
  const url = buildWorkItemUrl(id);
  const userDataDir = getUserDataDir();
  const launchOptions = getBrowserLaunchOptions();

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      viewport: { width: 1400, height: 900 },
      acceptDownloads: false
    });

    const page = context.pages()[0] || (await context.newPage());

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(
      () => null
    );

    if (await isLoginPage(page)) {
      throw new Error(
        'Sessão Azure DevOps não encontrada. Faça login no dev.azure.com e tente novamente.'
      );
    }

    const editor = await openDiscussionEditor(page);
    await insertComment(page, editor, payload.discussionPlain);
    await clickSave(page);

    return { url, mode: 'browser' };
  } catch (error) {
    if (context) {
      const pages = context.pages();
      if (pages[0]) {
        error.screenshotPath = await captureErrorScreenshot(pages[0], id);
      }
    }
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
  }
}

module.exports = {
  updateWorkItem,
  buildWorkItemUrl
};
