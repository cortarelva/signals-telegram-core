# Mac Superset Sync Instructions

Data: 2026-04-28
Objetivo: sincronizar o codigo do Mac para o GitHub sem mexer em producao e sem overwrite cego do branch principal de trabalho.

## Regras

- nao alterar config live automaticamente
- nao assumir que o estado do Mac e a verdade final
- nunca commitar `.env`
- nunca commitar `state.json`
- nunca commitar sqlite
- nunca commitar logs
- parar depois do `push`
- sem merge
- sem deploy
- sem overwrite do `codex/repo-sync-cleanup`

## Refs de Alinhamento

- `liveConfirmed`
  - branch: `codex/repo-sync-cleanup`
  - head: `9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13`
- `githubClean`
  - branch: `codex/repo-sync-cleanup`
  - head: `f064048f3a83f06617ab9b19554bf2a6d4689910`
- `tuneCommit`
  - head: `cd940aa36d27c028af46d015f14e53422c8f120d`

## Passos

### 1. Fetch antes de tudo

```bash
cd /Users/joel/Documents/CoddingStuff/TorusAiTrading
git fetch origin --prune
```

### 2. Gerar manifesto

```bash
node scripts/build-repo-manifest.js \
  --role mac-superset \
  --live-confirmed-branch codex/repo-sync-cleanup \
  --live-confirmed-head 9653eb0c0e8b5cde836fbaa4449aa8e18b1b1d13 \
  --github-clean-branch codex/repo-sync-cleanup \
  --github-clean-head f064048f3a83f06617ab9b19554bf2a6d4689910 \
  --tune-head cd940aa36d27c028af46d015f14e53422c8f120d \
  --output runtime/mac-repo-manifest.json
```

### 3. Criar branch proprio

Se o branch ainda nao existir:

```bash
git switch -c codex/mac-superset-sync
```

Se o branch ja existir:

```bash
git switch codex/mac-superset-sync
```

## 4. Verificar o working tree antes do commit

```bash
git status --short
```

Confirmar que nao entram:

- `.env`
- `state.json`
- sqlite
- logs
- artefactos de runtime

### 5. Commitar so o necessario

Commitar apenas:

- codigo novo relevante
- `runtime/mac-repo-manifest.json`
- nota curta com:
  - hotspots alterados
  - testes corridos
  - resultado dos testes

### 6. Push

```bash
git push -u origin codex/mac-superset-sync
```

### 7. Parar ai

Nao fazer:

- merge
- deploy
- overwrite do `codex/repo-sync-cleanup`

## Resultado Esperado

No fim deve existir um branch separado com:

- o codigo novo do Mac
- o manifesto `runtime/mac-repo-manifest.json`
- contexto suficiente para reconciliar:
  - `live-confirmed baseline`
  - `github-clean branch`
  - `mac-superset`
