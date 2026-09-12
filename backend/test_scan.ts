import { ScannerService } from './src/modules/scanner/scanner.service';

async function run() {
  console.log('Starting manual scan...');
  try {
    await ScannerService.scanDirectory('PUBMED/Day 1/Photos');
    console.log('Scan complete.');
  } catch (e) {
    console.error('Scan failed:', e);
  }
  process.exit(0);
}
run();
