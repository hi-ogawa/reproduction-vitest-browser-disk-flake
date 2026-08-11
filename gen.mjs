import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const N = Number(process.argv[2] ?? 100);

rmSync('src', { recursive: true, force: true });
mkdirSync('src', { recursive: true });

for (let i = 0; i < N; i++) {
  writeFileSync(
    `src/empty-${i}.test.js`,
    `import { test } from 'vitest';\n\ntest('empty ${i}', () => { document.body.appendChild(document.createElement('div')); });\n`,
  );
}

console.log(`generated ${N} empty browser test files in src/`);
