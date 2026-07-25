import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const forbidden = [/\bimport\b/, /\bopen\s*\(/, /\bexec\s*\(/, /\beval\s*\(/, /__/, /\bos\b/, /\bsys\b/, /\bsubprocess\b/, /\bsocket\b/];

export type RunResult = { status: 'passed' | 'failed' | 'error' | 'timeout'; stdout: string; stderr: string; durationMs: number };
const remoteResult = z.object({
  status: z.enum(['passed', 'failed', 'error', 'timeout']),
  stdout: z.string().max(16_384),
  stderr: z.string().max(16_384),
  durationMs: z.number().int().nonnegative().max(10_000),
});

export async function runPython(source: string, expectedOutput: string): Promise<RunResult> {
  if (source.length > 4000) throw new Error('SOURCE_TOO_LARGE');
  if (forbidden.some((pattern) => pattern.test(source))) throw new Error('UNSAFE_SOURCE');
  if (config.CODE_RUNNER_PROVIDER === 'remote') {
    const response = await fetch(config.CODE_RUNNER_URL!, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.CODE_RUNNER_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        language: 'python',
        source,
        expectedOutput,
        limits: { timeoutMs: 5_000, memoryMb: 128, outputBytes: 16_384, network: false },
      }),
      signal: AbortSignal.timeout(7_000),
    }).catch(() => { throw new Error('RUNNER_UNAVAILABLE'); });
    if (!response.ok) throw new Error('RUNNER_UNAVAILABLE');
    const parsed = remoteResult.safeParse(await response.json());
    if (!parsed.success) throw new Error('RUNNER_INVALID_RESPONSE');
    return parsed.data;
  }
  if (config.CODE_RUNNER_PROVIDER !== 'local' || config.NODE_ENV === 'production') throw new Error('RUNNER_UNAVAILABLE');
  const started = performance.now();
  const encodedSource = Buffer.from(source, 'utf8').toString('base64');
  const wrapper = `import base64,sys;sys.stdout.reconfigure(encoding="utf-8");sys.stderr.reconfigure(encoding="utf-8");exec(compile(base64.b64decode("${encodedSource}"),"<student>","exec"),{"__builtins__":{"print":print,"range":range,"len":len,"str":str,"int":int,"float":float,"bool":bool,"list":list,"dict":dict,"set":set,"tuple":tuple,"enumerate":enumerate}})`;
  try {
    const result = await execFileAsync('python', ['-I', '-S', '-c', wrapper], {
      timeout: 10_000,
      maxBuffer: 16 * 1024,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PYTHONIOENCODING: 'utf-8',
      },
    });
    const stdout = result.stdout.trim();
    return { status: stdout === expectedOutput.trim() ? 'passed' : 'failed', stdout, stderr: result.stderr.trim(), durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    const failure = error as { killed?: boolean; stdout?: string; stderr?: string; message?: string };
    return {
      status: failure.killed ? 'timeout' : 'error',
      stdout: failure.stdout?.slice(0, 16_384) ?? '',
      stderr: (failure.stderr || failure.message || 'Execution failed').slice(0, 16_384),
      durationMs: Math.round(performance.now() - started),
    };
  }
}
