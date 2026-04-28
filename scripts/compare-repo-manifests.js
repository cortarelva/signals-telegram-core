#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function mapKeys(obj) {
  return new Set(Object.keys(obj || {}));
}

function diffSets(left, right) {
  const onlyLeft = [...left].filter((item) => !right.has(item)).sort();
  const onlyRight = [...right].filter((item) => !left.has(item)).sort();
  return { onlyLeft, onlyRight };
}

function shallowEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeBaselineRefs(manifest) {
  const refs = manifest ? manifest.baselineRefs : null;
  if (!refs) return null;
  if (refs.liveConfirmed || refs.githubClean || refs.tuneCommit) {
    return {
      liveConfirmed: refs.liveConfirmed || { branch: null, head: null },
      githubClean: refs.githubClean || { branch: null, head: null },
      tuneCommit: refs.tuneCommit || { head: null },
    };
  }
  return {
    liveConfirmed: { branch: null, head: null },
    githubClean: {
      branch: Object.prototype.hasOwnProperty.call(refs, "branch") ? refs.branch : null,
      head: Object.prototype.hasOwnProperty.call(refs, "head") ? refs.head : null,
    },
    tuneCommit: { head: null },
  };
}

function compareLiveUniverse(baseManifest, otherManifest) {
  const baseUniverse = baseManifest.liveUniverse || {};
  const otherUniverse = otherManifest.liveUniverse || {};
  const baseKeys = mapKeys(baseUniverse);
  const otherKeys = mapKeys(otherUniverse);
  const changed = [];

  for (const symbol of [...baseKeys].filter((s) => otherKeys.has(s)).sort()) {
    if (!shallowEqual(baseUniverse[symbol], otherUniverse[symbol])) {
      changed.push({
        symbol,
        base: baseUniverse[symbol],
        other: otherUniverse[symbol],
      });
    }
  }

  return {
    ...diffSets(baseKeys, otherKeys),
    changed,
  };
}

function compareHotspots(baseManifest, otherManifest) {
  const baseHotspots = baseManifest.hotspots || {};
  const otherHotspots = otherManifest.hotspots || {};
  const keys = new Set([...Object.keys(baseHotspots), ...Object.keys(otherHotspots)]);
  const changed = [];
  for (const key of [...keys].sort()) {
    const baseSha = baseHotspots[key] ? baseHotspots[key].sha256 : null;
    const otherSha = otherHotspots[key] ? otherHotspots[key].sha256 : null;
    if (baseSha !== otherSha) {
      changed.push({ file: key, baseSha256: baseSha, otherSha256: otherSha });
    }
  }
  return changed;
}

function compareEnv(baseManifest, otherManifest) {
  const baseEnv = baseManifest.env || {};
  const otherEnv = otherManifest.env || {};
  const keys = new Set([...Object.keys(baseEnv), ...Object.keys(otherEnv)]);
  const changed = [];
  for (const key of [...keys].sort()) {
    const left = Object.prototype.hasOwnProperty.call(baseEnv, key) ? baseEnv[key] : null;
    const right = Object.prototype.hasOwnProperty.call(otherEnv, key) ? otherEnv[key] : null;
    if (left !== right) changed.push({ key, base: left, other: right });
  }
  return changed;
}

function comparePackageMeta(baseManifest, otherManifest) {
  const baseMeta = baseManifest.packageMeta || {};
  const otherMeta = otherManifest.packageMeta || {};
  const keys = new Set([...Object.keys(baseMeta), ...Object.keys(otherMeta)]);
  const changed = [];
  for (const key of [...keys].sort()) {
    const left = Object.prototype.hasOwnProperty.call(baseMeta, key) ? baseMeta[key] : null;
    const right = Object.prototype.hasOwnProperty.call(otherMeta, key) ? otherMeta[key] : null;
    if (left !== right) changed.push({ key, base: left, other: right });
  }
  return changed;
}

function compareTestSummary(baseManifest, otherManifest) {
  const base = baseManifest.testSummary || null;
  const other = otherManifest.testSummary || null;
  if (shallowEqual(base, other)) return null;
  return { base, other };
}

function main() {
  const [basePath, otherPath] = process.argv.slice(2);
  if (!basePath || !otherPath) {
    console.error("Usage: node scripts/compare-repo-manifests.js <base.json> <other.json>");
    process.exit(1);
  }

  const baseManifest = loadJson(basePath);
  const otherManifest = loadJson(otherPath);
  const report = {
    generatedAt: new Date().toISOString(),
    base: {
      repoRoot: baseManifest.repoRoot,
      branch: baseManifest.git ? baseManifest.git.branch : null,
      head: baseManifest.git ? baseManifest.git.head : null,
    },
    other: {
      repoRoot: otherManifest.repoRoot,
      branch: otherManifest.git ? otherManifest.git.branch : null,
      head: otherManifest.git ? otherManifest.git.head : null,
      role: otherManifest.role || null,
    },
    baseRole: baseManifest.role || null,
    baselineRefs: {
      base: normalizeBaselineRefs(baseManifest),
      other: normalizeBaselineRefs(otherManifest),
    },
    envDiff: compareEnv(baseManifest, otherManifest),
    packageMetaDiff: comparePackageMeta(baseManifest, otherManifest),
    liveUniverseDiff: compareLiveUniverse(baseManifest, otherManifest),
    hotspotDiff: compareHotspots(baseManifest, otherManifest),
    testSummaryDiff: compareTestSummary(baseManifest, otherManifest),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
