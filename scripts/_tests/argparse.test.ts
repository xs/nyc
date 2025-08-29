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
  parseList,
  makeFlagString,
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

  describe('makeFlagString', () => {
    it('make single character flag strings', () => {
      expect(makeFlagString('a')).toBe('-a');
    });

    it('make multiple character flag strings', () => {
      expect(makeFlagString('all')).toBe('--all');
      expect(makeFlagString('none')).toBe('--none');
    });

    it('make aliases', () => {
      let name: string;
      let aliases: string[];
      let expected: string;

      name = 'all';
      aliases = ['a'];
      expected = '--all (aliases: -a)';
      expect(makeFlagString(name, aliases)).toBe(expected);

      name = 'v';
      aliases = ['verbose'];
      expected = '-v (aliases: --verbose)';
      expect(makeFlagString(name, aliases)).toBe(expected);

      name = 'yes';
      aliases = ['y', 'ya', 'yeah', 'yuh'];
      expected = '--yes (aliases: -y, --ya, --yeah, --yuh)';
      expect(makeFlagString(name, aliases)).toBe(expected);
    });
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
      expect(parseRange('1,2,3', { name: 'test' })).toEqual([1, 2, 3]);
    });

    it('should parse ranges', () => {
      expect(parseRange('1-3', { name: 'test' })).toEqual([1, 2, 3]);
    });

    it('should parse mixed ranges and numbers', () => {
      expect(parseRange('1,3-5,7', { name: 'test' })).toEqual([1, 3, 4, 5, 7]);
    });

    it('should remove duplicates', () => {
      expect(parseRange('1,1,2', { name: 'test' })).toEqual([1, 2]);
    });

    it('should throw error for invalid range', () => {
      expect(() => parseRange('invalid', { name: 'test' })).toThrow(ArgsError);
    });

    it('should throw error for empty input', () => {
      expect(() => parseRange('', { name: 'test' })).toThrow(ArgsError);
      expect(() => parseRange('   ', { name: 'test' })).toThrow(ArgsError);
    });
  });

  describe('parseList', () => {
    it('should parse lists', () => {
      let input = '1,2,3';
      let expected = ['1', '2', '3'];
      expect(parseList(input, { name: 'test' })).toEqual(expected);
    });

    it('should parse lists of size 1', () => {
      expect(parseList('apple', { name: 'test' })).toEqual(['apple']);
    });

    it('should trim parts', () => {
      let input = 'lots  ,  of  ,  space';
      let expected = ['lots', 'of', 'space'];
      expect(parseList(input, { name: 'test' })).toEqual(expected);
    });

    it('should remove empty strings', () => {
      let input = ',,a,b,,,,,c';
      let expected = ['a', 'b', 'c'];
      expect(parseList(input, { name: 'test' })).toEqual(expected);
    });

    it('should throw error for empty lists', () => {
      let input = ',,,,,,';
      expect(() => parseList(input, { name: 'test' })).toThrow(ArgsError);
    });

    it('should throw error for empty input', () => {
      expect(() => parseList('   ', { name: 'test' })).toThrow(ArgsError);
    });
  });

  describe('makeArgGetter', () => {
    it('should create getter with default value', () => {
      const getTestArg = makeArgGetter<string>(String, { default: 'default' });

      process.argv = ['node', 'script.js'];
      expect(getTestArg('test')).toBe('default');
    });

    it('should create getter with default value', () => {
      const getTestArg = makeArgGetter<string>(String, { default: 'default' });

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
