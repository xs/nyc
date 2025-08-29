// Core argument parsing utilities
// This module provides generic argument parsing functions that can be used by any script

// Custom error type for argument parsing errors
export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgsError';
  }
}

// Argument parsing options interface
export interface ArgOpts<T> {
  required?: boolean;
  default?: T | undefined;
}

// Get command line arguments (excluding script name and node executable)
function getArgs(): string[] {
  return process.argv.slice(2);
}

// Convert argument name to flag format
export function argNameToFlag(argName: string): string {
  return (argName.length == 1 ? '-' : '--') + argName;
}

// Core argument parsing function
export function getArg(name: string, aliases: string[] = []) {
  const allNames = [name, ...aliases];
  let flags = allNames.map(argNameToFlag);
  const args = getArgs();

  const arg = args.find((s) =>
    flags.some((flag) => s === flag || s.startsWith(flag + '='))
  );
  if (arg) {
    if (arg.includes('=')) return arg.split('=')[1];
    // Find the next argument as the value
    const index = args.indexOf(arg);
    if (index < args.length - 1 && !args[index + 1].startsWith('-')) {
      return args[index + 1];
    }
    // if next arg isn't a value, we have a "true" flag
    return true;
  }
  return undefined;
}

// Parse range arguments (e.g., "1,2,3" or "1-3")
export function parseRange(arg: string, argName: string): number[] {
  let numbers: Set<number> = new Set<number>();
  let ranges = arg.trim().split(',');

  // Handle empty or whitespace-only input
  if (ranges.length === 0 || (ranges.length === 1 && ranges[0].trim() === '')) {
    throw new ArgsError(
      `${argNameToFlag(argName)} takes a comma-separated range (e.g. "1,2,5-7")`
    );
  }

  for (const rangeStr of ranges) {
    const trimmedRange = rangeStr.trim();
    if (trimmedRange === '') continue; // Skip empty entries

    let num = Number(trimmedRange);
    let rangeMatch = trimmedRange.match(/(?<lower>\d+)-(?<upper>\d+)/);

    if (!isNaN(num)) {
      numbers.add(num);
      continue;
    } else if (rangeMatch) {
      const lower = Number(rangeMatch[1]);
      const upper = Number(rangeMatch[2]);
      if (lower <= upper) {
        for (let i = lower; i <= upper; i++) {
          numbers.add(i);
        }
        continue;
      }
    }

    throw new ArgsError(
      `${argNameToFlag(argName)} takes a comma-separated range (e.g. "1,2,5-7")`
    );
  }

  if (!numbers.size) {
    throw new ArgsError(
      `${argNameToFlag(argName)} takes a comma-separated range (e.g. "1,2,5-7")`
    );
  }

  return Array.from(numbers);
}

// Generic argument getter factory
export function makeArgGetter<T>(
  parse: (stringValue: string, argName: string) => T,
  defaultValue?: T
) {
  return function (
    name: string,
    aliases: string[] = [],
    opts?: ArgOpts<T>
  ): T | undefined {
    try {
      let argValue = getArg(name, aliases);
      let flagsString = [name, ...aliases].map(argNameToFlag).join('/');

      if (typeof argValue === 'string') {
        return parse(argValue, name);
      } else if (argValue === true) {
        if (typeof defaultValue === 'boolean') {
          return parse('true', name);
        } else {
          throw new ArgsError(`Using ${flagsString} requires passing a value`);
        }
      } else if (argValue === undefined) {
        if (opts?.default !== undefined) {
          return opts?.default;
        } else if (opts?.required) {
          throw new ArgsError(`${flagsString} is required`);
        } else {
          return defaultValue;
        }
      }
    } catch (e) {
      if (e instanceof ArgsError) {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      }
      throw e;
    }
  };
}

// Common argument getter functions
export const getStringArg = makeArgGetter<string>(String);
export const getRangeArg = makeArgGetter<number[]>(parseRange);
export const getNumberArg = makeArgGetter<number>(Number);
export const getBoolArg = makeArgGetter<boolean>(() => true, false);
