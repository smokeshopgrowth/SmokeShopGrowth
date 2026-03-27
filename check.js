const fs = require('fs');
const lines = fs.readFileSync('test_output.txt', 'utf16le').split('\n');
console.log(lines.filter(l => l.includes('✖')).join('\n'));
