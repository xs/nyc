# Tests for sample.ts

This directory contains tests for the `sample.ts` script functionality.

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch
```

## Test Coverage

The tests cover the following functionality:

### `sample.test.ts` - Tests for sample.ts functionality:

### ✅ Region Validation

- Tests that region names are validated correctly
- Validates both valid and invalid region names

### ✅ Coordinate Conversion

- Tests the lat/lng to EPSG:2263 coordinate conversion
- Uses simplified conversion for testing purposes

### ✅ Argument Parsing

- Tests range argument parsing (e.g., "1,2,3" or "1-3")
- Validates duplicate removal and range expansion

### ✅ Polygon Parsing

- Tests polygon string parsing from command line arguments
- Validates coordinate extraction and error handling
- Tests invalid coordinate detection

### ✅ File Operations

- Tests file path construction for chunk files
- Validates output directory and filename generation

### ✅ Constants and Configuration

- Tests that constants are correctly defined
- Validates XML namespace configurations

### `argparse.test.ts` - Tests for argparse.ts functionality:

- **Core Utilities**: Tests `getArg`, `argNameToFlag`, `parseRange`, `makeArgGetter`
- **Pre-built Getters**: Tests `getStringArg`, `getRangeArg`, `getNumberArg`, `getBoolArg`
- **Error Handling**: Tests `ArgsError` class and error conditions
- **Generic Functionality**: Tests the reusable argument parsing utilities

### `types.test.ts` - Tests for types.ts functionality:

- **Type Validation**: Tests that all types can be properly created and used
- **Coordinate Types**: Tests `Vec2`, `Vec3`, `Point`, `Polyline` types
- **Region Types**: Tests `Region` union type
- **Interface Types**: Tests `Envelope` and `FilterResult` interfaces

## Test Structure

```
scripts/
├── types.ts          # Type definitions for the project
├── argparse.ts       # Generic argument parsing utilities
├── sample.ts         # Main sample processing script
└── _tests/
    ├── sample.test.ts    # Tests for sample.ts functionality
    ├── argparse.test.ts  # Tests for argparse.ts functionality
    ├── types.test.ts     # Tests for types.ts functionality
    └── README.md         # This file
```

## Adding New Tests

To add new tests:

1. Add test cases to the existing test suites in `sample.test.ts`
2. Or create new test files following the pattern `*.test.ts`
3. Run `npm test` to verify all tests pass

## Notes

- Tests use **vitest** as the testing framework
- Tests are isolated and don't require actual data files
- Mock implementations are used for complex functions to keep tests fast
- Error handling is tested for robustness
