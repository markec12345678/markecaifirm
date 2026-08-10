import { describe, it, expect, vi } from 'vitest';
import { logger } from '../../src/lib/logger';

describe('logger', () => {
  it('error writes to console.error with route + message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('/api/test', 'something failed', new Error('boom'));
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('[ERROR]');
    expect(output).toContain('[/api/test]');
    expect(output).toContain('something failed');
    expect(output).toContain('boom');
    spy.mockRestore();
  });

  it('warn writes to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('/api/test', 'careful');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('[WARN]');
    spy.mockRestore();
  });

  it('info writes to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('/api/test', 'fyi');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('serializes Error meta with stack trace', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('test error');
    logger.error('/api/foo', 'failed', err);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('test error');
    expect(output).toContain('at ');
    spy.mockRestore();
  });

  it('serializes non-Error meta as JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('/api/foo', 'failed', { code: 500, path: '/test' });
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('"code":500');
    expect(output).toContain('"path":"/test"');
    spy.mockRestore();
  });
});
