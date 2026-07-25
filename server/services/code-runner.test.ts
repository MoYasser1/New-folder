import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPython } from './code-runner.js';
import { config } from '../config.js';

const originalProvider = config.CODE_RUNNER_PROVIDER;
const originalUrl = config.CODE_RUNNER_URL;
const originalToken = config.CODE_RUNNER_TOKEN;

afterEach(() => {
  config.CODE_RUNNER_PROVIDER = originalProvider;
  config.CODE_RUNNER_URL = originalUrl;
  config.CODE_RUNNER_TOKEN = originalToken;
  vi.unstubAllGlobals();
});

describe('local development code runner', () => {
  it('passes exact output and fails a wrong answer', async () => {
    await expect(runPython('print("أنا مستعد للمستقبل!")', 'أنا مستعد للمستقبل!'))
      .resolves.toMatchObject({ status: 'passed' });
    await expect(runPython('print("wrong")', 'expected')).resolves.toMatchObject({ status: 'failed' });
  }, 15_000);

  it('rejects filesystem and import access before execution', async () => {
    await expect(runPython('import os\nprint(os.getcwd())', '')).rejects.toThrow('UNSAFE_SOURCE');
    await expect(runPython('print(open("secret.txt").read())', '')).rejects.toThrow('UNSAFE_SOURCE');
  });

  it('uses the authenticated remote sandbox adapter with explicit limits', async () => {
    config.CODE_RUNNER_PROVIDER = 'remote';
    config.CODE_RUNNER_URL = 'https://runner.example/execute';
    config.CODE_RUNNER_TOKEN = 'runner-secret';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'passed', stdout: 'ready', stderr: '', durationMs: 25,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runPython('print("ready")', 'ready')).resolves.toMatchObject({ status: 'passed', stdout: 'ready' });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://runner.example/execute');
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer runner-secret');
    expect(JSON.parse(String(options.body))).toMatchObject({
      language: 'python',
      limits: { timeoutMs: 5000, memoryMb: 128, outputBytes: 16384, network: false },
    });
  });
});
