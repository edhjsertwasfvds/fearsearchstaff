const fs = require('fs');
const path = require('path');

const root = __dirname;
const requiredFiles = [
    'package.json',
    'src/server.js',
    'public/index.html',
    '.env.example'
];

let hasErrors = false;

for (const file of requiredFiles) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) {
        console.error(`❌ Missing required file: ${file}`);
        hasErrors = true;
    } else {
        console.log(`✅ Found: ${file}`);
    }
}

try {
    const packageJsonPath = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    if (!pkg.scripts || !pkg.scripts.start) {
        console.error('❌ package.json is missing scripts.start');
        hasErrors = true;
    } else {
        console.log('✅ package.json scripts.start is configured');
    }
} catch (error) {
    console.error('❌ Failed to parse package.json:', error.message);
    hasErrors = true;
}

if (hasErrors) {
    console.error('\nDeployment check failed.');
    process.exit(1);
}

console.log('\nDeployment check passed.');
