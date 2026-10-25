import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const executable = process.env.DSH_EXECUTABLE ?? 'D:/DeepSeek Harness/DeepSeek Harness.exe';
const script = process.env.DSH_TEST_SCRIPT ?? fileURLToPath(new URL('./host-integration.mjs', import.meta.url));
const result = spawnSync(executable, ['--expose-internals', script], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
