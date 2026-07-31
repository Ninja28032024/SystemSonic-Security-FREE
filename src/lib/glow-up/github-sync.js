// src/lib/glow-up/github-sync.js
const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const { obfuscarCodigo } = require(path.join(__dirname, 'obfuscator-core.js'));

const RAIZ = path.join(__dirname, '..', '..', '..');
const SETTINGS_GLOW_UP = path.join(RAIZ, 'settings', 'glow-up.json');

const IGNORAR_EXATOS = [
  'settings/config.json',
  'settings/Okarun-ApiKey.json',
  'settings/SystemZone-ApiKey.json',
  'settings/glow-up.json',
  'settings/glow-up-state.json',
  'settings/tmp-gp-schedule.json',
];

const IGNORAR_PREFIXOS = [
  'node_modules',
  '.git',
  'session',
  'database',
  'src/audios',
  'src/lib/glow-up',
  'src/AutoSystem/Marketplace/lib/file_',
];

const IGNORAR_SEGMENTOS = [
  'node_modules',
  '.git',
  'session',
  'database',
];

function carregarCfg() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_GLOW_UP, 'utf8'));
  } catch (_) {
    return null;
  }
}

function deveIgnorar(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  if (IGNORAR_EXATOS.includes(norm)) return true;
  if (IGNORAR_PREFIXOS.some(p => norm.startsWith(p))) return true;
  if (IGNORAR_SEGMENTOS.some(s => norm.split('/').includes(s))) return true;
  return false;
}

async function obterSHA(token, user, repo, branch, filePath) {
  try {
    const url = `https://api.github.com/repos/${user}/${repo}/contents/${filePath}?ref=${branch}`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SystemSonic-GlowUp',
      },
    });
    return res.data.sha || null;
  } catch (_) {
    return null;
  }
}

async function enviarParaGitHub(token, user, repo, branch, filePath, conteudo, mensagem) {
  try {
    const sha = await obterSHA(token, user, repo, branch, filePath);
    const url = `https://api.github.com/repos/${user}/${repo}/contents/${filePath}`;
    const payload = {
      message: mensagem,
      content: Buffer.from(conteudo, 'utf8').toString('base64'),
      branch,
    };
    if (sha) payload.sha = sha;
    await axios.put(url, payload, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SystemSonic-GlowUp',
      },
    });
    return true;
  } catch (err) {
    console.error(`[GLOW-UP] Erro ao enviar ${filePath}:`, err.response?.data?.message || err.message);
    return false;
  }
}

async function deletarNoGitHub(token, user, repo, branch, filePath) {
  try {
    const sha = await obterSHA(token, user, repo, branch, filePath);
    if (!sha) return;
    const url = `https://api.github.com/repos/${user}/${repo}/contents/${filePath}`;
    await axios.delete(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SystemSonic-GlowUp',
      },
      data: {
        message: `glow-up: remove ${filePath}`,
        sha,
        branch,
      },
    });
    console.log(`[GLOW-UP] 🗑️  ${filePath} removido do repositório FREE`);
  } catch (err) {
    console.error(`[GLOW-UP] Erro ao deletar ${filePath}:`, err.message);
  }
}

async function sincronizarArquivo(caminhoAbsoluto) {
  const cfg = carregarCfg();
  if (!cfg || !cfg.isBotRei) return;
  if (!cfg.githubToken || cfg.githubToken === 'SEU_TOKEN_GITHUB_AQUI') {
    console.warn('[GLOW-UP] ⚠️  Token do GitHub não configurado em settings/glow-up.json');
    return;
  }

  const relPath = path.relative(RAIZ, caminhoAbsoluto).replace(/\\/g, '/');
  if (deveIgnorar(relPath)) return;

  const { githubToken, githubUser, githubRepo, githubBranch } = cfg;

  try {
    const existeLocalmente = fs.existsSync(caminhoAbsoluto);

    if (!existeLocalmente) {
      await deletarNoGitHub(githubToken, githubUser, githubRepo, githubBranch, relPath);
      return;
    }

    const stat = fs.statSync(caminhoAbsoluto);
    if (!stat.isFile()) return;

    const conteudoOriginal = fs.readFileSync(caminhoAbsoluto, 'utf8');
    let conteudoEnviar;

    if (relPath.endsWith('.js')) {
      const resultado = obfuscarCodigo(conteudoOriginal);
      if (!resultado.ok) {
        console.warn(`[GLOW-UP] ⚠️  Falha ao ofuscar ${relPath}: ${resultado.error}`);
        conteudoEnviar = conteudoOriginal;
      } else {
        conteudoEnviar = resultado.code;
      }
    } else {
      conteudoEnviar = conteudoOriginal;
    }

    const mensagem = `glow-up: update ${relPath}`;
    const ok = await enviarParaGitHub(githubToken, githubUser, githubRepo, githubBranch, relPath, conteudoEnviar, mensagem);
    if (ok) {
      console.log(`[GLOW-UP] ✅ ${relPath} → repositório FREE`);
    }
  } catch (err) {
    console.error(`[GLOW-UP] Erro ao processar ${relPath}:`, err.message);
  }
}

const filaDebounce = new Map();

function agendarSincronizacao(caminhoAbsoluto) {
  if (filaDebounce.has(caminhoAbsoluto)) {
    clearTimeout(filaDebounce.get(caminhoAbsoluto));
  }
  const timer = setTimeout(() => {
    filaDebounce.delete(caminhoAbsoluto);
    sincronizarArquivo(caminhoAbsoluto).catch(e => {
      console.error('[GLOW-UP] Erro na sincronização:', e.message);
    });
  }, 2500);
  filaDebounce.set(caminhoAbsoluto, timer);
}

function monitorarDiretorio(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.watch(dir, { persistent: false }, (evento, nome) => {
      if (!nome) return;
      const caminhoCompleto = path.join(dir, nome);
      if (evento === 'change') {
        if (fs.existsSync(caminhoCompleto)) {
          agendarSincronizacao(caminhoCompleto);
        }
      } else if (evento === 'rename') {
        if (fs.existsSync(caminhoCompleto)) {
          const stat = fs.statSync(caminhoCompleto);
          if (stat.isFile()) {
            agendarSincronizacao(caminhoCompleto);
          } else if (stat.isDirectory()) {
            monitorarDiretorioRecursivo(caminhoCompleto);
          }
        } else {
          const relPath = path.relative(RAIZ, caminhoCompleto).replace(/\\/g, '/');
          if (!deveIgnorar(relPath)) {
            agendarSincronizacao(caminhoCompleto);
          }
        }
      }
    });
  } catch (err) {
    console.error(`[GLOW-UP] Erro ao monitorar ${dir}:`, err.message);
  }
}

function monitorarDiretorioRecursivo(dir) {
  if (!fs.existsSync(dir)) return;
  const relDir = path.relative(RAIZ, dir).replace(/\\/g, '/');
  if (deveIgnorar(relDir + '/')) return;

  monitorarDiretorio(dir);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name);
      const relSub = path.relative(RAIZ, sub).replace(/\\/g, '/');
      if (!deveIgnorar(relSub + '/')) {
        monitorarDiretorioRecursivo(sub);
      }
    }
  }
}

function iniciarGithubSync() {
  const cfg = carregarCfg();
  if (!cfg) {
    console.warn('[GLOW-UP] settings/glow-up.json não encontrado. Sincronização desativada.');
    return;
  }
  if (!cfg.isBotRei) return;
  if (!cfg.githubToken || cfg.githubToken === 'SEU_TOKEN_GITHUB_AQUI') {
    console.warn('[GLOW-UP] ⚠️  Configure o token do GitHub em settings/glow-up.json');
    return;
  }

  const alvos = [
    path.join(RAIZ, 'src'),
    path.join(RAIZ, 'settings'),
  ];

  for (const alvo of alvos) {
    monitorarDiretorioRecursivo(alvo);
  }

  const arquivosRaiz = ['index.js', 'package.json'];
  for (const arq of arquivosRaiz) {
    const caminho = path.join(RAIZ, arq);
    if (!fs.existsSync(caminho)) continue;
    try {
      fs.watch(caminho, { persistent: false }, (evento) => {
        if (evento === 'change') agendarSincronizacao(caminho);
      });
    } catch (_) {}
  }

}

module.exports = { iniciarGithubSync, sincronizarArquivo };
