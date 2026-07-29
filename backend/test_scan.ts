import { ScannerService } from './src/modules/scanner/scanner.service';
ScannerService.scanAllDirectories('').then(() => {
  console.log('Finished queuing scan-directory jobs.');
  process.exit(0);
}).catch(console.error);
