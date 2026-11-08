import { readFile, writeFile } from 'node:fs/promises'

const read = (name) => readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8')
const css = await read('desktop.css')
const code = await read('desktop.iife.js')

// Remove the previous mount before installing its new stylesheet.
const payload = `(() => {
  window.__codexDshStats?.dispose();
  const css = document.createElement('style');
  css.setAttribute('data-codex-dsh-stats', '');
  css.textContent = ${JSON.stringify(css)};
  document.head.append(css);
  try {
    ${code}
    return CodexDshStatsBundle;
  } catch (error) {
    css.remove();
    window.__codexDshStats?.dispose();
    throw error;
  } finally {
    delete window.__codexDshStatsOptions;
  }
})()`
await writeFile(new URL('../dist/desktop-payload.js', import.meta.url), payload, 'utf8')

