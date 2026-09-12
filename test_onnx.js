const fs = require('fs');
try {
  require('onnxruntime-node');
  console.log('SUCCESS');
} catch (e) {
  console.log('FAIL:', e.message);
}
