const {test,expect}=require('@playwright/test')
test('real Stockfish responds; undo, reset and black-side play work without Firebase',async({page})=>{
 const errors=[]; const requests=[]
 page.on('pageerror',e=>errors.push(e.message))
 page.on('request',r=>requests.push(r.url()))
 await page.goto('/')
 expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true)
 await expect(page.getByRole('heading',{name:'Chess Studio'})).toBeVisible()
 await page.locator('[data-squareid="e2"]').click()
 await page.locator('[data-squareid="e4"]').click()
 await expect(page.locator('.move-list')).toContainText(/^1\. e4 \S+/,{timeout:30000})
 await page.getByRole('button',{name:'Undo',exact:true}).click()
 await expect(page.locator('.move-list')).toHaveText('No moves yet.')
 await page.getByLabel('Your pieces').selectOption('b')
 await expect(page.locator('.move-list')).toContainText(/^1\. \S+/,{timeout:30000})
 await page.getByLabel('Your pieces').selectOption('w')
 await page.getByRole('button',{name:'New game',exact:true}).click()
 await expect(page.locator('.move-list')).toHaveText('No moves yet.')
 expect(requests.some(url=>/firebaseio|firestore.googleapis/.test(url))).toBe(false)
 expect(errors).toEqual([])
 await page.screenshot({path:'artifacts/desktop.png',fullPage:true})
})
test('mobile layout fits viewport and an invalid invitation does not break local play',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 await page.goto('/?game=invalid')
 await expect(page.getByRole('heading',{name:'Chess Studio'})).toBeVisible()
 await expect(page.getByRole('link',{name:'Built by Graphicnapkin'})).toHaveCount(0)
 await expect(page.getByRole('link',{name:'Source code'})).toHaveCount(0)
 await expect(page.locator('body')).not.toContainText(/YOUR NEXT MOVE|Let's play\.|A quiet place|Across the board|The opening is yours/)
 for (const width of [320,390,768,980,1024,1440]) {
  await page.setViewportSize({width,height:900})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),{message:`Layout fits ${width}px`}).toBe(true)
  const board=await page.locator('[data-squareid="h1"]').boundingBox()
  expect(board.x+board.width).toBeLessThanOrEqual(width)
 }
 await page.setViewportSize({width:390,height:844})
 await expect.poll(()=>page.locator('[data-squareid="h1"]').evaluate(el=>el.getBoundingClientRect().width)).toBeCloseTo((390-64)/8,0)
 await page.screenshot({path:'artifacts/mobile.png',fullPage:true})
})

test('keyboard moves, refresh recovery and pawn underpromotion work',async({page})=>{
 await page.goto('/')
 await page.getByLabel('Enter a move').fill('e4')
 await page.getByRole('button',{name:'Move',exact:true}).click()
 await expect(page.locator('.move-list')).toContainText(/^1\. e4 \S+/,{timeout:30000})
 const history=await page.locator('.move-list').textContent()
 await page.reload()
 await expect(page.locator('.move-list')).toHaveText(history)
 await page.evaluate(pgn=>localStorage.setItem('gnap-chess-local-v1',JSON.stringify({pgn,recordId:'00000000-0000-4000-8000-000000000099',recorded:false,color:'w',difficulty:5,resigned:false})),'[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n*')
 await page.reload()
 await page.locator('[data-squareid="a7"]').click()
 await page.locator('[data-squareid="a8"]').click()
 await page.getByRole('button',{name:'Knight',exact:true}).click()
 await expect(page.locator('.move-list')).toContainText('a8=N')
 await expect(page.getByRole('dialog',{name:'Draw',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Review board',exact:true}).click()
 await expect(page.getByRole('status')).toHaveText('Draw')
})

// Themes are preferences: switching them must preserve the current game.
test('board themes update squares, survive reload, and support keyboard selection',async({page})=>{
 await page.goto('/')
 await page.getByLabel('Enter a move').fill('e4')
 await page.getByRole('button',{name:'Move',exact:true}).click()
 await expect(page.locator('.move-list')).toContainText(/^1\. e4 \S+/,{timeout:30000})
 const history=await page.locator('.move-list').textContent()
 for (const [name,dark] of [['Sand','rgb(181, 164, 139)'],['Forest','rgb(130, 148, 122)'],['Ocean','rgb(132, 153, 172)'],['Walnut','rgb(176, 132, 99)'],['Plum','rgb(170, 147, 178)']]) {
  await page.getByRole('radio',{name,exact:true}).check()
  await expect(page.getByRole('radio',{name,exact:true})).toBeChecked()
  await expect(page.locator('[data-squareid="a3"]')).toHaveCSS('background-color',dark)
  await expect(page.locator('.move-list')).toHaveText(history)
 }
 await page.reload()
 await expect(page.getByRole('radio',{name:'Plum',exact:true})).toBeChecked()
 await expect(page.locator('.move-list')).toHaveText(history)
 await page.getByRole('radio',{name:'Plum',exact:true}).focus()
 await page.keyboard.press('ArrowLeft')
 await expect(page.getByRole('radio',{name:'Walnut',exact:true})).toBeChecked()
 await page.evaluate(()=>localStorage.setItem('gnap-board-theme','invalid-theme'))
 await page.reload()
 await expect(page.getByRole('radio',{name:'Sand',exact:true})).toBeChecked()
})

test('provider buttons render local logos and the interface font loads',async({page})=>{
 await page.goto('/')
 await page.evaluate(()=>document.fonts.ready)
 expect(await page.evaluate(()=>Array.from(document.fonts).some(font=>font.family.includes('DM Sans') && font.status==='loaded'))).toBe(true)
 for(const name of ['Sign in with Google','Continue with GitHub']) {
  const button=page.getByRole('button',{name,exact:true})
  await expect(button).toBeVisible()
  await expect(button.locator('img')).toBeVisible()
  await expect.poll(()=>button.locator('img').evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true)
 }
 await page.screenshot({path:'artifacts/desktop.png',fullPage:true})
})

test('piece styles preserve games, persist, and render complete captured pieces',async({page})=>{
 const {Chess}=require('chess.js')
 const game=new Chess()
 for(const move of ['e2e4','d7d5','e4d5','d8d5','b1c3','d5e5','f1e2','e5e2','c3e2','b8c6'])game.move(move)
 await page.goto('/')
 await page.evaluate(pgn=>sessionStorage.setItem('gnap-chess-local-v1',pgn),game.pgn())
 await page.reload()
 const history=await page.locator('.move-list').textContent()
 await expect(page.locator('.captured-piece')).toHaveCount(4)
 await expect(page.getByRole('img',{name:'White bishop',exact:true})).toBeVisible()
 await expect(page.getByRole('img',{name:'Black queen',exact:true})).toBeVisible()
 const icons=page.locator('.captured-piece svg')
 await expect(icons).toHaveCount(4)
 for(const icon of await icons.all()) {
  await expect(icon).toHaveAttribute('viewBox','0 0 45 45')
  const bounds=await icon.boundingBox()
  expect(bounds.width).toBe(28);expect(bounds.height).toBe(28)
  expect(await icon.evaluate(svg=>{const b=svg.getBBox();return b.x>=0 && b.y>=0 && b.x+b.width<=45 && b.y+b.height<=45})).toBe(true)
 }
 await page.locator('.board-panel').screenshot({path:'artifacts/captures-classic.png'})
 for(const name of ['Chessnut','Spatial']) {
  await page.getByRole('radio',{name,exact:true}).check()
  await expect(page.locator('.move-list')).toHaveText(history)
  await expect(page.locator('.board img')).toHaveCount(28)
  for(const img of await page.locator('.board img, .captured-piece img').all()) {
   await expect(img).toHaveAttribute('src',new RegExp(`/pieces/${name.toLowerCase()}/`))
   await expect.poll(()=>img.evaluate(el=>el.complete && el.naturalWidth>0)).toBe(true)
  }
  await page.locator('.board-panel').screenshot({path:`artifacts/captures-${name.toLowerCase()}.png`})
 }
 await page.reload()
 await expect(page.getByRole('radio',{name:'Spatial',exact:true})).toBeChecked()
 await expect(page.locator('.move-list')).toHaveText(history)
 await page.getByRole('radio',{name:'Spatial',exact:true}).focus()
 await page.keyboard.press('ArrowLeft')
 await expect(page.getByRole('radio',{name:'Chessnut',exact:true})).toBeChecked()
 await page.getByRole('button',{name:'New game',exact:true}).click()
 await expect(page.locator('.captured-piece')).toHaveCount(0)
 await page.locator('[data-squareid="e2"]').dragTo(page.locator('[data-squareid="e4"]'))
 await expect(page.locator('.move-list')).toContainText(/^1\. e4 \S+/,{timeout:30000})
 await page.evaluate(()=>localStorage.setItem('gnap-piece-style','invalid'))
 await page.reload()
 await expect(page.getByRole('radio',{name:'Classic',exact:true})).toBeChecked()
})

test('checkmate dialog identifies winners, traps focus and supports review and restart',async({page})=>{
 const {Chess}=require('chess.js');const game=new Chess()
 ;['f3','e5','g4','Qh4#'].forEach(move=>game.move(move))
 await page.goto('/')
 await page.evaluate(pgn=>{sessionStorage.setItem('gnap-chess-local-v1',pgn);sessionStorage.setItem('gnap-color','w')},game.pgn())
 await page.reload()
 const dialog=page.getByRole('dialog',{name:'Checkmate',exact:true})
 await expect(dialog).toBeVisible()
 await expect(dialog).toContainText('Stockfish won')
 await expect(dialog).toContainText('Black wins by checkmate.')
 await expect(page.getByRole('button',{name:'Review board',exact:true})).toBeFocused()
 for(let i=0;i<4;i++) {await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true)}
 await page.screenshot({path:'artifacts/checkmate-desktop.png',fullPage:false})
 await page.keyboard.press('Escape')
 await expect(dialog).not.toBeVisible()
 await expect(page.getByRole('status')).toContainText('Stockfish won')
 await page.getByRole('button',{name:'View result',exact:true}).click()
 await expect(dialog).toBeVisible()
 await page.getByRole('button',{name:'Review board',exact:true}).click()
 await page.evaluate(()=>sessionStorage.setItem('gnap-color','b'))
 await page.setViewportSize({width:390,height:844})
 await page.reload()
 await expect(dialog).toContainText('You won!')
 const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390)
 await page.screenshot({path:'artifacts/checkmate-mobile.png'})
 await dialog.getByRole('button',{name:'New game',exact:true}).click()
 await expect(dialog).not.toBeVisible()
 await expect(page.locator('.move-list')).toContainText(/^1\. \S+/,{timeout:30000})
})

test('signed-in online players see results from their assigned seat',async({browser})=>{
 const roomId='11111111-1111-4111-8111-111111111111'
 for(const [userId,outcome] of [['white-user','Your opponent won'],['black-user','You won!']]) {
  const context=await browser.newContext()
  await context.route('https://*.supabase.co/**',async route=>{
   const game={id:roomId,white_id:'white-user',black_id:'black-user',moves:['f2f3','e7e5','g2g4','d8h4'],fen:'',version:4,status:'finished',result:'0-1',expires_at:'2099-01-01T00:00:00Z'}
   const url=route.request().url()
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.includes('/functions/')?{game}:url.includes('/rest/')?game:{})})
  })
  await context.routeWebSocket('wss://*.supabase.co/**',socket=>socket.close())
  await context.addInitScript(id=>{
   const user={id,aud:'authenticated',email:'test@example.invalid',app_metadata:{provider:'github'},user_metadata:{full_name:'Test Player'},created_at:'2026-01-01T00:00:00Z'}
   const token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:id,exp:4070908800}))+'.test'
   const session=JSON.stringify({access_token:token,refresh_token:'test-only',expires_at:4070908800,expires_in:3600,token_type:'bearer',user})
   const original=Storage.prototype.getItem
   Storage.prototype.getItem=function(key){return key.startsWith('sb-')&&key.endsWith('-auth-token')?session:original.call(this,key)}
  },userId)
  const page=await context.newPage();await page.goto('/?game='+roomId)
  await page.getByRole('button',{name:'Join / resume invited game',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Checkmate',exact:true})
  await expect(dialog).toBeVisible();await expect(dialog).toContainText(outcome)
  await expect(dialog).toContainText('Black wins by checkmate.')
  await context.close()
 }
})
