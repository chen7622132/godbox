/**
 * 把工作区里的源码同步到 GitHub 仓库（一次 commit 提交多个文件）。
 * 用法：node scripts/push.mjs "提交说明"
 * 需要环境变量 GH_TOKEN。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const OWNER = 'chen7622132';
const REPO = 'godbox';
const BRANCH = 'main';
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) throw new Error('缺少 GH_TOKEN 环境变量');

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

/** 要同步的文件（相对项目根目录）——排除 node_modules / dist / 待生成文件 */
const INCLUDE_DIRS = ['src', 'scripts', '.github'];
const INCLUDE_FILES = [
  'index.html',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'README.md',
  '.gitignore',
  'godbox.html',
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function collect() {
  const files = [];
  for (const d of INCLUDE_DIRS) {
    try {
      walk(d, files);
    } catch {
      /* 目录不存在就跳过 */
    }
  }
  for (const f of INCLUDE_FILES) {
    try {
      if (statSync(f).isFile()) files.push(f);
    } catch {
      /* 文件不存在就跳过 */
    }
  }
  // 去掉测试/调试脚本，不必上传
  return files.filter((f) => !f.includes('ui-check') && !f.includes('livecheck'));
}

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, { headers, ...init });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${pathname} -> ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  const message = process.argv[2] ?? 'chore: sync';

  // 1) 当前分支头
  const ref = await api(`/git/ref/heads/${BRANCH}`);
  const baseSha = ref.object.sha;
  const baseCommit = await api(`/git/commits/${baseSha}`);
  const baseTree = baseCommit.tree.sha;

  // 2) 为每个文件建 blob
  const files = collect();
  const tree = [];
  for (const f of files) {
    const content = readFileSync(f);
    const isBinary = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf)$/i.test(f);
    const blob = await api('/git/blobs', {
      method: 'POST',
      body: JSON.stringify(
        isBinary
          ? { content: content.toString('base64'), encoding: 'base64' }
          : { content: content.toString('utf8'), encoding: 'utf-8' },
      ),
    });
    tree.push({ path: relative('.', f).replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3) 建新 tree
  const newTree = await api('/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });

  // 4) 建 commit
  const commit = await api('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
  });

  // 5) 推进分支
  await api(`/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  console.log(`✓ 已提交 ${files.length} 个文件`);
  console.log(`  commit: ${commit.sha.slice(0, 7)}`);
  console.log(`  ${message}`);
  console.log(`  查看: https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
}

main().catch((e) => {
  console.error('✗ 失败:', e.message);
  process.exit(1);
});
