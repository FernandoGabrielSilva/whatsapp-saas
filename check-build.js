import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

console.log('Checking build structure...');

const pathsToCheck = [
  './standalone',
  './standalone/apps/web',
  './standalone/apps/web/.next/static',
  './standalone/apps/web/public',
  './apps/web/.next/static',
  './node_modules'
];

pathsToCheck.forEach(path => {
  console.log(`${existsSync(path) ? '✅' : '❌'} ${path}`);
  
  if (existsSync(path)) {
    try {
      const files = readdirSync(path).slice(0, 5);
      console.log(`   Contains: ${files.join(', ')}${files.length > 5 ? '...' : ''}`);
    } catch (e) {
      console.log(`   Error reading: ${e.message}`);
    }
  }
});

console.log('\nBuild check completed.');
