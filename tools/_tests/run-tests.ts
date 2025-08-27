import { runTests as runCityGMLTests } from './extract-citygml.test';

console.log('🚀 Running all tests...\n');

try {
  runCityGMLTests();
  console.log('\n✨ All test suites completed successfully!');
} catch (error) {
  console.error('\n💥 Test suite failed:', error);
  process.exit(1);
}
