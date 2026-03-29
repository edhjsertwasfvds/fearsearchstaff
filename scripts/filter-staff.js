const fs = require('fs');
const path = require('path');

const srcPath = path.join(process.env.USERPROFILE || '', 'Downloads', '[.txt');
const dataDir = path.join(__dirname, '..', 'public', 'data');
const outAdminsPath = path.join(dataDir, 'staff-admins.json');

const raw = fs.readFileSync(srcPath, 'utf8');
const data = JSON.parse(raw);

const main = data.filter(x => x.group_name !== 'ADMIN' && x.group_name !== 'ADMIN+');
const removed = data.filter(x => x.group_name === 'ADMIN' || x.group_name === 'ADMIN+');

fs.writeFileSync(srcPath, JSON.stringify(main, null, 4), 'utf8');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(outAdminsPath, JSON.stringify(removed, null, 4), 'utf8');

console.log('File updated: removed', removed.length, '(Админ/Админ+). Saved to', outAdminsPath);
console.log('Remaining in file:', main.length);
