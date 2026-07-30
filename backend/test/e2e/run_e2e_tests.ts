import { runTier1Tests } from './tier1_feature_coverage.test';
import { runTier2Tests } from './tier2_boundary_corner.test';
import { runTier3Tests } from './tier3_cross_feature.test';
import { runTier4Tests } from './tier4_real_world.test';
import { closeConnections, cleanupTestData } from './helpers';

async function main() {
  const startTime = Date.now();
  console.log('================================================================');
  console.log('       hellomyphotos Requirement-Driven E2E Test Suite        ');
  console.log('================================================================\n');

  let totalPassed = 0;
  let totalFailed = 0;
  const tierSummaries: { tier: string; passed: number; failed: number; total: number }[] = [];

  try {
    // Run Tier 1
    const t1 = await runTier1Tests();
    totalPassed += t1.passed;
    totalFailed += t1.failed;
    tierSummaries.push({ tier: 'Tier 1: Feature Coverage (4 Domains)', passed: t1.passed, failed: t1.failed, total: t1.passed + t1.failed });

    // Run Tier 2
    const t2 = await runTier2Tests();
    totalPassed += t2.passed;
    totalFailed += t2.failed;
    tierSummaries.push({ tier: 'Tier 2: Boundary & Corner Cases', passed: t2.passed, failed: t2.failed, total: t2.passed + t2.failed });

    // Run Tier 3
    const t3 = await runTier3Tests();
    totalPassed += t3.passed;
    totalFailed += t3.failed;
    tierSummaries.push({ tier: 'Tier 3: Cross-Feature Interactions', passed: t3.passed, failed: t3.failed, total: t3.passed + t3.failed });

    // Run Tier 4
    const t4 = await runTier4Tests();
    totalPassed += t4.passed;
    totalFailed += t4.failed;
    tierSummaries.push({ tier: 'Tier 4: Real-World Scenarios', passed: t4.passed, failed: t4.failed, total: t4.passed + t4.failed });

  } catch (err: any) {
    console.error('\nFatal error executing E2E test suite:', err);
    totalFailed++;
  } finally {
    await cleanupTestData();
    await closeConnections();
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n================================================================');
  console.log('                     E2E TEST RESULTS SUMMARY                   ');
  console.log('================================================================');
  for (const s of tierSummaries) {
    const status = s.failed === 0 ? 'PASSED' : 'FAILED';
    console.log(`  [${status}] ${s.tier.padEnd(45)}: ${s.passed}/${s.total} passed`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`  TOTAL: ${totalPassed}/${totalPassed + totalFailed} tests passed (${durationSec}s)`);
  console.log('================================================================\n');

  if (totalFailed > 0) {
    console.error(`E2E Test Suite completed with ${totalFailed} failure(s).`);
    process.exit(1);
  } else {
    console.log('All E2E tests passed successfully!');
    process.exit(0);
  }
}

main();
