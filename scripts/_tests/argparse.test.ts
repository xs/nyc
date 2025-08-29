import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getArg,
  argNameToFlag,
  parseRange,
  makeArgGetter,
  getStringArg,
  getRangeArg,
  getNumberArg,
  getBoolArg,
  ArgsError,
} from '../argparse.js';

describe('argparse.ts functionality', () => {
  let originalArgv: string[];

  beforeEach(() => {
    // Save original process.argv
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    // Restore original process.argv
    process.argv = [...originalArgv];
  });

  describe('argNameToFlag', () => {
    it('should convert single character to short flag', () => {
      expect(argNameToFlag('i')).toBe('-i');
      expect(argNameToFlag('p')).toBe('-p');
    });

    it('should convert multi-character to long flag', () => {
      expect(argNameToFlag('index')).toBe('--index');
      expect(argNameToFlag('percent')).toBe('--percent');
    });
  });

  describe('getArg', () => {
    it('should find arguments with exact match', () => {
      process.argv = ['node', 'script.js', '--test', 'value'];

      expect(getArg('test')).toBe('value');
    });

    it('should find arguments with aliases', () => {
      process.argv = ['node', 'script.js', '-t', 'value'];

      expect(getArg('test', ['t'])).toBe('value');
    });

    it('should handle equals syntax', () => {
      process.argv = ['node', 'script.js', '--test=value'];

      expect(getArg('test')).toBe('value');
    });

    it('should return true for boolean flags', () => {
      process.argv = ['node', 'script.js', '--flag'];

      expect(getArg('flag')).toBe(true);
    });

    it('should return undefined for missing arguments', () => {
      process.argv = ['node', 'script.js'];

      expect(getArg('missing')).toBeUndefined();
    });
  });

  describe('parseRange', () => {
    it('should parse simple numbers', () => {
      expect(parseRange('1,2,3', 'test')).toEqual([1, 2, 3]);
    });

    it('should parse ranges', () => {
      expect(parseRange('1-3', 'test')).toEqual([1, 2, 3]);
    });

    it('should parse mixed ranges and numbers', () => {
      expect(parseRange('1,3-5,7', 'test')).toEqual([1, 3, 4, 5, 7]);
    });

    it('should remove duplicates', () => {
      expect(parseRange('1,1,2', 'test')).toEqual([1, 2]);
    });

    it('should throw error for invalid range', () => {
      expect(() => parseRange('invalid', 'test')).toThrow(ArgsError);
    });

    it('should throw error for empty input', () => {
      expect(() => parseRange('', 'test')).toThrow(ArgsError);
      expect(() => parseRange('   ', 'test')).toThrow(ArgsError);
    });
  });

  describe('makeArgGetter', () => {
    it('should create getter with default value', () => {
      const getTestArg = makeArgGetter<string>(String, 'default');

      process.argv = ['node', 'script.js'];
      expect(getTestArg('test')).toBe('default');
    });

    it('should create getter with default value', () => {
      const getTestArg = makeArgGetter<string>(String, 'default');

      process.argv = ['node', 'script.js'];
      expect(getTestArg('test')).toBe('default');
    });

    it('should parse values correctly', () => {
      const getTestArg = makeArgGetter<number>(Number);

      process.argv = ['node', 'script.js', '--test', '42'];
      expect(getTestArg('test')).toBe(42);
    });
  });

  describe('pre-built argument getters', () => {
    it('should parse string arguments', () => {
      process.argv = ['node', 'script.js', '--test', 'hello'];
      expect(getStringArg('test')).toBe('hello');
    });

    it('should parse number arguments', () => {
      process.argv = ['node', 'script.js', '--test', '42'];
      expect(getNumberArg('test')).toBe(42);
    });

    it('should parse range arguments', () => {
      process.argv = ['node', 'script.js', '--test', '1,2,3'];
      expect(getRangeArg('test')).toEqual([1, 2, 3]);
    });

    it('should parse boolean arguments', () => {
      process.argv = ['node', 'script.js', '--test'];
      expect(getBoolArg('test')).toBe(true);
    });

    it('should handle boolean arguments with default false', () => {
      process.argv = ['node', 'script.js'];
      expect(getBoolArg('test')).toBe(false);
    });
  });

  describe('ArgsError', () => {
    it('should create error with correct name', () => {
      const error = new ArgsError('test message');
      expect(error.name).toBe('ArgsError');
      expect(error.message).toBe('test message');
    });
  });
});
