const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(root,'build/stockfish'),{recursive:true})
for (const file of ['stockfish.js','stockfish.wasm','Copying.txt']) {
  fs.copyFileSync(path.join(root,'dist/stockfish',file),path.join(root,'build/stockfish',file))
}
fs.copyFileSync(path.join(root,'public/index.html'),path.join(root,'build/index.html'))

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}
copyDir(path.join(root, 'public/ui'), path.join(root, 'build/ui'))
